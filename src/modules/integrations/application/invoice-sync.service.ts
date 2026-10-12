import { Injectable } from '@nestjs/common';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { Money } from '@/shared/domain/money';
import { ExternalInvoice } from '../domain/canonical';
import {
  CollectionLedger,
  ExternalRef,
  ExternalRefRepository,
  NewReview,
  ProcessSettlement,
  RefUpsert,
  ReviewRepository,
} from '../domain/integration.repository';
import { normalizeNif, validateExternalInvoice } from '../domain/mapping';
import { decide, processClosure } from '../domain/reconciliation';
import { SyncContext } from './sync-context';

const code = (prefix: string, id: number) => `${prefix}-${String(id).padStart(5, '0')}`;

/** uma ligação pode aparecer duas vezes na mesma página (ligada agora e logo reconciliada): fica o estado mais recente e a origem da primeira */
const mergeRefs = (rows: RefUpsert[]): RefUpsert[] => {
  const m = new Map<string, RefUpsert>();
  for (const r of rows) {
    const k = `${r.entity}|${r.externalId}`;
    const prev = m.get(k);
    m.set(k, prev ? { ...r, linkedBy: prev.linkedBy } : r);
  }
  return [...m.values()];
};

/** Uma página de facturas do ERP a tratar numa transacção. */
interface PageWork {
  reviews: NewReview[];
  refs: RefUpsert[];
  /** processo → tipos de liquidação que o tocaram nesta página */
  touched: Map<number, Set<'PAID' | 'CANCELLED'>>;
}

/**
 * O coração da integração: para cada factura vinda do ERP
 *  - já ligada a uma factura do Cobraqui → reconcilia (paga, anulada, parcial, valor alterado);
 *  - não ligada mas com o mesmo número no Cobraqui → liga-a e reconcilia;
 *  - nova e em aberto → cria o devedor (se preciso) e a factura.
 * No fim da página, os processos tocados que ficaram com tudo liquidado fecham (ou vão para revisão).
 */
@Injectable()
export class InvoiceSyncService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly refs: ExternalRefRepository,
    private readonly reviews: ReviewRepository,
    private readonly ledger: CollectionLedger,
    private readonly notifications: NotificationPublisher,
  ) {}

  /** clientes que vão ser precisos para criar devedores (lidos ANTES da transacção da página) */
  async prefetchCustomers(ctx: SyncContext, items: ExternalInvoice[]): Promise<void> {
    const invoiceRefs = await this.refs.byExternalIds('INVOICE', items.map((i) => i.externalId));
    const wanted = [...new Set(items.filter((i) => !invoiceRefs.has(i.externalId) && (i.status === 'OPEN' || i.status === 'PARTIAL')).map((i) => i.customerExternalId))];
    const debtorRefs = await this.refs.byExternalIds('DEBTOR', wanted);
    const missing = wanted.filter((c) => !debtorRefs.has(c) && !ctx.customers.has(c));
    for (let i = 0; i < missing.length; i += 200) {
      for (const c of await ctx.connector.customersByIds(missing.slice(i, i + 200))) ctx.customers.set(c.externalId, c);
    }
  }

  /** trata uma página numa transacção (que se junta à da simulação, se houver) */
  async processPage(ctx: SyncContext, items: ExternalInvoice[]): Promise<void> {
    const fresh = items.filter((i) => !ctx.handled.has(i.externalId));
    if (!fresh.length) return;
    await this.prefetchCustomers(ctx, fresh);
    await this.uow.run(async () => {
      const work: PageWork = { reviews: [], refs: [], touched: new Map() };
      const linked = await this.refs.byExternalIds('INVOICE', fresh.map((i) => i.externalId));

      // 1) sem ligação: liga pelo número ou cria
      const unlinked = fresh.filter((i) => !linked.has(i.externalId));
      const matched = await this.linkOrCreate(ctx, unlinked, work);
      for (const [externalId, ref] of matched) linked.set(externalId, ref);

      // 2) com ligação: reconcilia
      await this.reconcile(ctx, fresh.filter((i) => linked.has(i.externalId)), linked, work);

      // 3) grava ligações, fecha processos, abre revisões
      await this.refs.upsert(mergeRefs(work.refs));
      await this.settleProcesses(ctx, work);
      const opened = await this.reviews.open(work.reviews);
      ctx.count('reviewsOpened', opened);
    });
    fresh.forEach((i) => ctx.handled.add(i.externalId));
    ctx.count('invoicesRead', fresh.length);
  }

  /** facturas que o ERP deixou de devolver (verificação completa) */
  async processMissing(ctx: SyncContext, externalIds: string[]): Promise<void> {
    const ids = externalIds.filter((x) => !ctx.handled.has(x));
    if (!ids.length) return;
    await this.uow.run(async () => {
      const linked = await this.refs.byExternalIds('INVOICE', ids);
      const snaps = await this.ledger.invoiceSnapshots([...linked.values()].map((r) => r.localId));
      const reviews: NewReview[] = [];
      for (const ref of linked.values()) {
        const snap = snaps.get(ref.localId);
        if (!snap) continue;
        const d = decide({ ...snap, lastSeen: { status: ref.status, amount: ref.amount, openAmount: ref.openAmount } }, null);
        if (d.action === 'REVIEW') {
          reviews.push({ runId: ctx.runId, kind: d.kind, externalId: ref.externalId, invoiceId: snap.invoiceId, processId: snap.processId, summary: d.summary });
          ctx.log({ externalId: ref.externalId, action: d.kind, message: d.summary }, true);
        }
      }
      await this.refs.touch('INVOICE', ids);
      ctx.count('reviewsOpened', await this.reviews.open(reviews));
      ctx.count('missingInErp', reviews.length);
    });
    ids.forEach((x) => ctx.handled.add(x));
  }

  /* ───────────── ligar facturas existentes / criar novas ───────────── */

  private async linkOrCreate(ctx: SyncContext, items: ExternalInvoice[], work: PageWork): Promise<Map<string, ExternalRef>> {
    const out = new Map<string, ExternalRef>();
    if (!items.length) return out;

    const locals = await this.ledger.invoicesByReference(items.map((i) => i.reference));
    const byRef = new Map<string, typeof locals>();
    for (const l of locals) byRef.set(l.reference.toLowerCase(), [...(byRef.get(l.reference.toLowerCase()) ?? []), l]);
    const alreadyLinked = await this.refs.byLocalIds('INVOICE', locals.map((l) => l.invoiceId));
    const usedLocal = new Set<number>();

    const toCreate: ExternalInvoice[] = [];
    for (const ext of items) {
      const candidates = byRef.get(ext.reference.toLowerCase()) ?? [];
      if (!candidates.length) {
        if (ext.status === 'OPEN' || ext.status === 'PARTIAL') toCreate.push(ext);
        else ctx.count('skippedSettledUnknown'); // paga ou anulada no ERP e nunca esteve no Cobraqui: nada a fazer
        continue;
      }
      const org = ctx.companies.get(ext.companyCode);
      const exact = candidates.filter(
        (c) => Money.of(c.amount).equals(ext.amount) && (org === undefined || c.organizationId === org) && !alreadyLinked.has(c.invoiceId) && !usedLocal.has(c.invoiceId),
      );
      if (exact.length === 1) {
        const c = exact[0];
        usedLocal.add(c.invoiceId);
        // estado base "OPEN sem valores": a reconciliação a seguir aplica o que o ERP disser (ex.: já paga)
        const ref: ExternalRef = { entity: 'INVOICE', externalId: ext.externalId, localId: c.invoiceId, companyCode: ext.companyCode, status: 'OPEN', amount: null, openAmount: null };
        out.set(ext.externalId, ref);
        work.refs.push({ ...ref, linkedBy: 'MATCH' });
        ctx.count('invoicesLinked');
        ctx.log({ externalId: ext.externalId, action: 'LINK', message: `Factura ${c.reference} ligada ao documento do ERP` });
        continue;
      }
      const summary = `O documento ${ext.reference} do ERP corresponde a ${candidates.length} factura(s) do Cobraqui com o mesmo número, mas o valor, o credor ou uma ligação anterior não batem certo. Confirme qual é.`;
      work.reviews.push({ runId: ctx.runId, kind: 'AMBIGUOUS_MATCH', externalId: ext.externalId, invoiceId: candidates[0].invoiceId, processId: null, summary, details: { erpAmount: ext.amount, candidates: candidates.map((c) => ({ invoiceId: c.invoiceId, amount: c.amount })) } });
      ctx.log({ externalId: ext.externalId, action: 'AMBIGUOUS_MATCH', message: summary }, true);
    }

    await this.createInvoices(ctx, toCreate, work);
    return out;
  }

  private async createInvoices(ctx: SyncContext, items: ExternalInvoice[], work: PageWork): Promise<void> {
    if (!items.length) return;
    const createdBy = ctx.settings.actorUserId ?? ctx.settings.updatedById;
    const debtorRefs = await this.refs.byExternalIds('DEBTOR', [...new Set(items.map((i) => i.customerExternalId))]);
    const nifs = [...new Set([...ctx.customers.values()].map((c) => normalizeNif(c.nif)).filter((n): n is string => !!n))];
    const byNif = await this.ledger.debtorsByNif(nifs);
    const debtorOf = new Map<string, number>([...debtorRefs.values()].map((r) => [r.externalId, r.localId]));

    for (const ext of items) {
      const review = (kind: NewReview['kind'], summary: string, details?: Record<string, unknown>) => {
        work.reviews.push({ runId: ctx.runId, kind, externalId: ext.externalId, invoiceId: null, processId: null, summary, details });
        ctx.log({ externalId: ext.externalId, action: kind, message: summary }, true);
      };

      const org = ctx.companies.get(ext.companyCode);
      if (org === undefined) {
        review('UNMAPPED_COMPANY', `A empresa ${ext.companyCode} do ERP não está associada a nenhum credor; o documento ${ext.reference} não foi importado.`);
        continue;
      }
      const { errors, timeLimitDays } = validateExternalInvoice(ext);
      const currencyId = ctx.currencies.get(ext.currency.toUpperCase());
      if (!currencyId) errors.push(`moeda ${ext.currency} não está activa no Cobraqui`);
      if (!createdBy) errors.push('a integração não tem utilizador responsável (active-a de novo)');
      if (errors.length) {
        review('INVALID_DATA', `O documento ${ext.reference} do ERP não pode ser importado: ${errors.join('; ')}.`);
        continue;
      }

      // devedor: ligação → NIF → criar
      let debtorId = debtorOf.get(ext.customerExternalId);
      if (debtorId === undefined) {
        const customer = ctx.customers.get(ext.customerExternalId);
        if (!customer) {
          review('INVALID_DATA', `O cliente ${ext.customerExternalId} do documento ${ext.reference} não foi encontrado no ERP.`);
          continue;
        }
        const nif = normalizeNif(customer.nif);
        const existing = nif ? byNif.get(nif) : undefined;
        if (existing) {
          if (existing.organizationId !== org) {
            review('DEBTOR_CONFLICT', `O NIF ${nif} do cliente ${customer.name} já pertence ao devedor "${existing.name}" de outro credor.`, { debtorId: existing.debtorId });
            continue;
          }
          debtorId = existing.debtorId;
          work.refs.push({ entity: 'DEBTOR', externalId: customer.externalId, localId: debtorId, companyCode: customer.companyCode, status: 'OPEN', amount: null, openAmount: null, linkedBy: 'MATCH' });
          ctx.count('debtorsLinked');
        } else {
          const missing = [!customer.email && 'email', !customer.phone && 'telefone'].filter(Boolean);
          if (!ctx.settings.importDebtors || missing.length) {
            review(
              'DEBTOR_INCOMPLETE',
              !ctx.settings.importDebtors
                ? `O cliente ${customer.name} não existe no Cobraqui e a criação automática de devedores está desligada.`
                : `O cliente ${customer.name} (${customer.externalId}) não tem ${missing.join(' nem ')} no ERP; complete no ERP ou crie o devedor à mão.`,
              { customerExternalId: customer.externalId },
            );
            continue;
          }
          const created = await this.ledger.createDebtor({
            name: customer.name.trim(),
            nif,
            email: customer.email!.trim().toLowerCase(),
            phone: customer.phone!.trim(),
            address: customer.address?.trim() || '-',
            isCompany: customer.isCompany,
            organizationId: org,
          });
          if (created === null) {
            review('DEBTOR_CONFLICT', `Não foi possível criar o devedor ${customer.name}: o nome, email ou telefone já pertence a outro devedor.`, { customerExternalId: customer.externalId });
            continue;
          }
          debtorId = created;
          work.refs.push({ entity: 'DEBTOR', externalId: customer.externalId, localId: debtorId, companyCode: customer.companyCode, status: 'OPEN', amount: null, openAmount: null, linkedBy: 'IMPORT' });
          ctx.count('debtorsCreated');
          ctx.log({ externalId: customer.externalId, action: 'CREATE_DEBTOR', message: `Devedor ${customer.name} criado` });
        }
        debtorOf.set(ext.customerExternalId, debtorId);
        if (nif) byNif.set(nif, { debtorId, organizationId: org, name: customer.name });
      }

      const invoiceId = await this.ledger.createInvoice({
        reference: ext.reference.trim(),
        amount: Money.of(ext.amount).toString(),
        issueDate: ext.issueDate,
        dueDate: ext.dueDate,
        timeLimitDays,
        debtorId,
        currencyId: currencyId!,
        createdById: createdBy!,
      });
      if (invoiceId === null) {
        review('AMBIGUOUS_MATCH', `O número ${ext.reference} já existe no Cobraqui; o documento do ERP não foi importado.`);
        continue;
      }
      work.refs.push({ entity: 'INVOICE', externalId: ext.externalId, localId: invoiceId, companyCode: ext.companyCode, status: ext.status, amount: ext.amount, openAmount: ext.openAmount, linkedBy: 'IMPORT' });
      ctx.count('invoicesCreated');
      ctx.log({ externalId: ext.externalId, action: 'CREATE_INVOICE', message: `Factura ${ext.reference} criada (${ext.amount} ${ext.currency}, vence a ${ext.dueDate})` });
    }
  }

  /* ───────────── reconciliação ───────────── */

  private async reconcile(ctx: SyncContext, items: ExternalInvoice[], linked: Map<string, ExternalRef>, work: PageWork): Promise<void> {
    if (!items.length) return;
    const snaps = await this.ledger.invoiceSnapshots(items.map((i) => linked.get(i.externalId)!.localId));
    const paid: number[] = [];
    const cancelled: number[] = [];

    for (const ext of items) {
      const ref = linked.get(ext.externalId)!;
      const snap = snaps.get(ref.localId);
      // a ligação passa sempre a reflectir o que o ERP diz agora
      work.refs.push({ entity: 'INVOICE', externalId: ext.externalId, localId: ref.localId, companyCode: ext.companyCode, status: ext.status, amount: ext.amount, openAmount: ext.openAmount, linkedBy: 'IMPORT' });
      if (!snap) continue;

      const d = decide({ ...snap, lastSeen: { status: ref.status, amount: ref.amount, openAmount: ref.openAmount } }, ext);
      const touch = (kind: 'PAID' | 'CANCELLED') => {
        if (snap.processId) work.touched.set(snap.processId, (work.touched.get(snap.processId) ?? new Set()).add(kind));
      };
      switch (d.action) {
        case 'NONE':
          ctx.count('unchanged');
          break;
        case 'MARK_PAID':
          paid.push(snap.invoiceId);
          touch('PAID');
          ctx.count('invoicesPaid');
          ctx.log({ externalId: ext.externalId, action: 'MARK_PAID', message: `Factura ${snap.reference} paga no ERP → Liquidada` });
          break;
        case 'MARK_CANCELLED':
          cancelled.push(snap.invoiceId);
          touch('CANCELLED');
          ctx.count('invoicesCancelled');
          ctx.log({ externalId: ext.externalId, action: 'MARK_CANCELLED', message: `Factura ${snap.reference} anulada no ERP → Cancelada` });
          break;
        case 'RECORD_PARTIAL':
          ctx.count('invoicesPartial');
          ctx.log({ externalId: ext.externalId, action: 'RECORD_PARTIAL', message: `Factura ${snap.reference}: pagamento parcial no ERP, em aberto ${d.openAmount}` });
          break;
        case 'UPDATE_AMOUNT':
          if (await this.ledger.updateInvoiceAmount(snap.invoiceId, d.amount)) {
            ctx.count('amountsUpdated');
            ctx.log({ externalId: ext.externalId, action: 'UPDATE_AMOUNT', message: `Factura ${snap.reference}: valor ${snap.amount} → ${d.amount}` });
          }
          break;
        case 'REVIEW':
          work.reviews.push({ runId: ctx.runId, kind: d.kind, externalId: ext.externalId, invoiceId: snap.invoiceId, processId: snap.processId, summary: d.summary });
          ctx.log({ externalId: ext.externalId, action: d.kind, message: d.summary }, true);
          break;
      }
    }
    await this.ledger.setInvoiceState(paid, 'PAID');
    await this.ledger.setInvoiceState(cancelled, 'CANCELLED');
  }

  /** processos tocados nesta página: fecham se ficaram com tudo liquidado e sem acordo */
  private async settleProcesses(ctx: SyncContext, work: PageWork): Promise<void> {
    if (!work.touched.size) return;
    const closed: ProcessSettlement[] = [];
    for (const s of await this.ledger.processSettlements([...work.touched.keys()])) {
      const verdict = processClosure({ allSettled: s.allSettled, agreementActive: s.agreementActive, autoClose: ctx.settings.autoClose });
      const kinds = work.touched.get(s.processId)!;
      const reason = kinds.has('PAID') ? 'PAID_IN_ERP' : 'CANCELLED_IN_ERP';
      if (verdict === 'CLOSE') {
        if (await this.ledger.closeProcess(s.processId, reason)) {
          closed.push(s);
          ctx.count('processesClosed');
          ctx.log({ action: 'CLOSE_PROCESS', message: `Processo ${code('PRC', s.processId)} (${s.debtorName}) fechado: ${reason === 'PAID_IN_ERP' ? 'pago' : 'anulado'} no ERP` }, true);
        }
      } else if (verdict === 'REVIEW') {
        const summary = `Todas as facturas do processo ${code('PRC', s.processId)} (${s.debtorName}) estão liquidadas no ERP. O fecho automático está desligado: confirme para fechar.`;
        work.reviews.push({ runId: ctx.runId, kind: 'PROCESS_READY_TO_CLOSE', externalId: `process:${s.processId}`, invoiceId: null, processId: s.processId, summary, details: { reason } });
        ctx.count('processesReadyToClose');
        ctx.log({ action: 'PROCESS_READY_TO_CLOSE', message: summary }, true);
      }
    }
    if (!closed.length) return;
    await this.notifications.publish(
      closed.flatMap((s) =>
        [...new Set([s.agentId, s.managerId].filter((x): x is number => typeof x === 'number'))].map((userId) => ({
          userId,
          type: 'integration.process_closed',
          title: 'Processo fechado pelo ERP',
          message: `O processo ${code('PRC', s.processId)} (${s.debtorName}) foi fechado: todas as facturas aparecem liquidadas no SAP.`,
          data: { processId: s.processId },
          actionUrl: `/processes/${s.processId}`,
        })),
      ),
    );
  }
}
