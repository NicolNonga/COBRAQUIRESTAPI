import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { Money } from '@/shared/domain/money';
import { ExternalCustomer, ExternalInvoice } from '../domain/canonical';
import { ErpConnector } from '../domain/erp-connector.port';
import {
  CollectionLedger,
  ExternalRef,
  ExternalRefRepository,
  IntegrationSettings,
  NewReview,
  RefEntity,
  RefUpsert,
  ReviewRepository,
} from '../domain/integration.repository';
import { InvoiceSyncService } from './invoice-sync.service';
import { SyncContext } from './sync-context';

/* ───────────── fakes em memória das portas ───────────── */

type Inv = { id: number; reference: string; state: string; amount: string; debtorId: number; processId: number | null };
type Proc = { id: number; closed: boolean; agreement: boolean; debtorName: string; agentId: number | null };

class World {
  refs = new Map<string, RefUpsert>();
  reviews: Array<NewReview & { status: string }> = [];
  invoices: Inv[] = [];
  processes: Proc[] = [];
  debtors: Array<{ id: number; name: string; nif: string | null; email: string; organizationId: number }> = [];
  notifications: unknown[] = [];

  refRepo(): ExternalRefRepository {
    const key = (e: RefEntity, x: string) => `${e}|${x}`;
    const asRef = (r: RefUpsert): ExternalRef => ({ entity: r.entity, externalId: r.externalId, localId: r.localId, companyCode: r.companyCode, status: r.status, amount: r.amount, openAmount: r.openAmount });
    return {
      byExternalIds: async (e: RefEntity, ids: string[]) => new Map(ids.filter((x) => this.refs.has(key(e, x))).map((x) => [x, asRef(this.refs.get(key(e, x))!)])),
      byLocalIds: async (e: RefEntity, ids: number[]) => new Map([...this.refs.values()].filter((r) => r.entity === e && ids.includes(r.localId)).map((r) => [r.localId, asRef(r)])),
      upsert: async (rows: RefUpsert[]) => {
        const seen = new Set<string>();
        for (const r of rows) {
          const k = key(r.entity, r.externalId);
          if (seen.has(k)) throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time');
          seen.add(k);
          const prev = this.refs.get(k);
          this.refs.set(k, prev ? { ...prev, status: r.status, amount: r.amount, openAmount: r.openAmount } : r);
        }
      },
      openInvoicesNotSeenSince: async () => [],
      touch: async () => undefined,
    } as ExternalRefRepository;
  }

  reviewRepo(): ReviewRepository {
    return {
      open: async (items: NewReview[]) => {
        let n = 0;
        for (const i of items) {
          if (this.reviews.some((r) => r.kind === i.kind && r.externalId === i.externalId && r.status === 'OPEN')) continue;
          this.reviews.push({ ...i, status: 'OPEN' });
          n++;
        }
        return n;
      },
    } as unknown as ReviewRepository;
  }

  ledger(): CollectionLedger {
    const settled = (s: string) => s === 'PAID' || s === 'CANCELLED';
    const procInvoices = (pid: number) => this.invoices.filter((i) => i.processId === pid);
    return {
      invoiceSnapshots: async (ids: number[]) =>
        new Map(
          this.invoices
            .filter((i) => ids.includes(i.id))
            .map((i) => {
              const p = this.processes.find((x) => x.id === i.processId && !x.closed);
              return [i.id, { invoiceId: i.id, reference: i.reference, state: i.state as never, amount: i.amount, debtorId: i.debtorId, processId: p?.id ?? null, agreementActive: !!p?.agreement }];
            }),
        ),
      setInvoiceState: async (ids: number[], state: string) => this.invoices.filter((i) => ids.includes(i.id)).forEach((i) => (i.state = state)),
      updateInvoiceAmount: async (id: number, amount: string) => {
        const i = this.invoices.find((x) => x.id === id)!;
        if (Money.of(i.amount).equals(amount)) return false;
        i.amount = amount;
        return true;
      },
      processSettlements: async (ids: number[]) =>
        this.processes
          .filter((p) => ids.includes(p.id) && !p.closed)
          .map((p) => ({ processId: p.id, allSettled: procInvoices(p.id).length > 0 && procInvoices(p.id).every((i) => settled(i.state)), agreementActive: p.agreement, debtorName: p.debtorName, agentId: p.agentId, managerId: null })),
      closeProcess: async (id: number) => {
        const p = this.processes.find((x) => x.id === id)!;
        if (p.closed || p.agreement || !procInvoices(id).every((i) => settled(i.state))) return false;
        p.closed = true;
        return true;
      },
      invoicesByReference: async (refs: string[]) =>
        this.invoices
          .filter((i) => refs.map((r) => r.toLowerCase()).includes(i.reference.toLowerCase()))
          .map((i) => ({ invoiceId: i.id, reference: i.reference, debtorId: i.debtorId, debtorNif: null, organizationId: this.debtors.find((d) => d.id === i.debtorId)?.organizationId ?? 1, amount: i.amount })),
      debtorsByNif: async (nifs: string[]) => new Map(this.debtors.filter((d) => d.nif && nifs.includes(d.nif)).map((d) => [d.nif!, { debtorId: d.id, organizationId: d.organizationId, name: d.name }])),
      createDebtor: async (d: { name: string; nif: string | null; email: string; organizationId: number }) => {
        if (this.debtors.some((x) => x.email === d.email || x.name === d.name)) return null;
        const id = this.debtors.length + 100;
        this.debtors.push({ id, name: d.name, nif: d.nif, email: d.email, organizationId: d.organizationId });
        return id;
      },
      createInvoice: async (n: { reference: string; amount: string; debtorId: number }) => {
        if (this.invoices.some((i) => i.reference.toLowerCase() === n.reference.toLowerCase())) return null;
        const id = this.invoices.length + 1000;
        this.invoices.push({ id, reference: n.reference, state: 'IN_PROGRESS', amount: n.amount, debtorId: n.debtorId, processId: null });
        return id;
      },
    } as unknown as CollectionLedger;
  }
}

const customer = (over: Partial<ExternalCustomer> = {}): ExternalCustomer => ({
  externalId: 'C1', companyCode: '1000', name: 'Sonangol Distribuidora', nif: '5410000001', email: 'financeiro@exemplo.ao', phone: '923000001', address: 'Luanda', isCompany: true, ...over,
});
const invoice = (over: Partial<ExternalInvoice> = {}): ExternalInvoice => ({
  externalId: '1000/2026/90000001/1', companyCode: '1000', customerExternalId: 'C1', reference: '2026/90000001', issueDate: '2026-05-01', dueDate: '2026-06-01',
  amount: '150000.00', openAmount: '150000.00', currency: 'AOA', status: 'OPEN', changedAt: '2026-10-01T10:00:00Z', ...over,
});

function setup(opts: { autoClose?: boolean; customers?: ExternalCustomer[] } = {}) {
  const w = new World();
  const uow = { run: (fn: () => Promise<unknown>) => fn() } as unknown as UnitOfWork;
  const notifications = { publish: async (n: unknown) => void w.notifications.push(n) } as unknown as NotificationPublisher;
  const service = new InvoiceSyncService(uow, w.refRepo(), w.reviewRepo(), w.ledger(), notifications);
  const connector = { customersByIds: async (ids: string[]) => (opts.customers ?? [customer()]).filter((c) => ids.includes(c.externalId)) } as unknown as ErpConnector;
  const settings = { autoClose: opts.autoClose ?? true, importDebtors: true, actorUserId: 7, updatedById: 7 } as IntegrationSettings;
  const ctx = () => new SyncContext(1, false, settings, connector, new Map([['1000', 1]]), new Map([['AOA', 1]]), new Date());
  return { w, service, ctx };
}

describe('InvoiceSyncService', () => {
  it('factura nova em aberto → cria devedor e factura, e guarda as ligações', async () => {
    const { w, service, ctx } = setup();
    const c = ctx();
    await service.processPage(c, [invoice()]);
    expect(w.debtors).toHaveLength(1);
    expect(w.invoices).toMatchObject([{ reference: '2026/90000001', amount: '150000.00', state: 'IN_PROGRESS' }]);
    expect(w.refs.get('INVOICE|1000/2026/90000001/1')).toMatchObject({ linkedBy: 'IMPORT', status: 'OPEN' });
    expect(w.refs.get('DEBTOR|C1')).toMatchObject({ linkedBy: 'IMPORT' });
    expect(c.counters).toMatchObject({ debtorsCreated: 1, invoicesCreated: 1 });
  });

  it('factura que já existia no Cobraqui, paga no SAP → liga, liquida e fecha o processo (sem duplicar a ligação)', async () => {
    const { w, service, ctx } = setup();
    w.debtors.push({ id: 1, name: 'Sonangol Distribuidora', nif: '5410000001', email: 'x@y.ao', organizationId: 1 });
    w.invoices.push({ id: 1, reference: '2026/90000001', state: 'OVERDUE', amount: '150000.00', debtorId: 1, processId: 10 });
    w.processes.push({ id: 10, closed: false, agreement: false, debtorName: 'Sonangol', agentId: 5 });
    const c = ctx();
    await service.processPage(c, [invoice({ status: 'CLEARED', openAmount: '0.00' })]);
    expect(w.invoices[0].state).toBe('PAID');
    expect(w.processes[0].closed).toBe(true);
    expect(w.refs.get('INVOICE|1000/2026/90000001/1')).toMatchObject({ linkedBy: 'MATCH', status: 'CLEARED' });
    expect(c.counters).toMatchObject({ invoicesLinked: 1, invoicesPaid: 1, processesClosed: 1 });
    expect(w.notifications).toHaveLength(1);
  });

  it('paga no SAP com acordo activo → revisão, não liquida nem fecha', async () => {
    const { w, service, ctx } = setup();
    w.debtors.push({ id: 1, name: 'D', nif: null, email: 'x@y.ao', organizationId: 1 });
    w.invoices.push({ id: 1, reference: '2026/90000001', state: 'OVERDUE', amount: '150000.00', debtorId: 1, processId: 10 });
    w.processes.push({ id: 10, closed: false, agreement: true, debtorName: 'D', agentId: 5 });
    await service.processPage(ctx(), [invoice({ status: 'CLEARED', openAmount: '0.00' })]);
    expect(w.invoices[0].state).toBe('OVERDUE');
    expect(w.processes[0].closed).toBe(false);
    expect(w.reviews).toMatchObject([{ kind: 'PAID_WITH_AGREEMENT', invoiceId: 1, processId: 10 }]);
  });

  it('fecho automático desligado → processo pronto a fechar vai para revisão', async () => {
    const { w, service, ctx } = setup({ autoClose: false });
    w.debtors.push({ id: 1, name: 'D', nif: null, email: 'x@y.ao', organizationId: 1 });
    w.invoices.push({ id: 1, reference: '2026/90000001', state: 'OVERDUE', amount: '150000.00', debtorId: 1, processId: 10 });
    w.processes.push({ id: 10, closed: false, agreement: false, debtorName: 'D', agentId: 5 });
    await service.processPage(ctx(), [invoice({ status: 'CLEARED', openAmount: '0.00' })]);
    expect(w.invoices[0].state).toBe('PAID');
    expect(w.processes[0].closed).toBe(false);
    expect(w.reviews).toMatchObject([{ kind: 'PROCESS_READY_TO_CLOSE', externalId: 'process:10' }]);
  });

  it('processo com duas facturas e só uma paga → continua aberto', async () => {
    const { w, service, ctx } = setup();
    w.debtors.push({ id: 1, name: 'D', nif: null, email: 'x@y.ao', organizationId: 1 });
    w.invoices.push({ id: 1, reference: '2026/90000001', state: 'OVERDUE', amount: '150000.00', debtorId: 1, processId: 10 });
    w.invoices.push({ id: 2, reference: '2026/90000002', state: 'OVERDUE', amount: '90000.00', debtorId: 1, processId: 10 });
    w.processes.push({ id: 10, closed: false, agreement: false, debtorName: 'D', agentId: 5 });
    await service.processPage(ctx(), [invoice({ status: 'CLEARED', openAmount: '0.00' })]);
    expect(w.invoices.map((i) => i.state)).toEqual(['PAID', 'OVERDUE']);
    expect(w.processes[0].closed).toBe(false);
  });

  it('segunda execução com os mesmos dados → nada muda (idempotente)', async () => {
    const { w, service, ctx } = setup();
    await service.processPage(ctx(), [invoice()]);
    const c2 = ctx();
    await service.processPage(c2, [invoice()]);
    expect(w.invoices).toHaveLength(1);
    expect(w.debtors).toHaveLength(1);
    expect(c2.counters).toMatchObject({ unchanged: 1 });
    expect(c2.counters.invoicesCreated).toBeUndefined();
  });

  it('cliente sem email no SAP → revisão "devedor incompleto", nada é criado', async () => {
    const { w, service, ctx } = setup({ customers: [customer({ email: null })] });
    await service.processPage(ctx(), [invoice()]);
    expect(w.debtors).toHaveLength(0);
    expect(w.invoices).toHaveLength(0);
    expect(w.reviews).toMatchObject([{ kind: 'DEBTOR_INCOMPLETE' }]);
  });

  it('empresa do SAP sem credor associado → revisão, nada é criado', async () => {
    const { w, service, ctx } = setup();
    await service.processPage(ctx(), [invoice({ companyCode: '2000' })]);
    expect(w.invoices).toHaveLength(0);
    expect(w.reviews).toMatchObject([{ kind: 'UNMAPPED_COMPANY' }]);
  });

  it('paga no SAP e nunca esteve no Cobraqui → ignorada', async () => {
    const { w, service, ctx } = setup();
    const c = ctx();
    await service.processPage(c, [invoice({ status: 'CLEARED', openAmount: '0.00' })]);
    expect(w.invoices).toHaveLength(0);
    expect(c.counters).toMatchObject({ skippedSettledUnknown: 1 });
  });
});
