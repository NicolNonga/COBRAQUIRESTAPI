import { Injectable, Logger } from '@nestjs/common';
import { MarkOverdueInvoicesUseCase } from '@/modules/invoices/application/mark-overdue-invoices.use-case';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { AssignWalletProcessesUseCase } from '@/modules/processes/application/assignment.use-cases';
import { GenerateCollectionProcessesUseCase } from '@/modules/processes/application/generate-collection-processes.use-case';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { RequestContext } from '@/shared/application/request-context';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError } from '@/shared/domain/errors';
import { ErpConnectorFactory } from '../domain/erp-connector.port';
import {
  CollectionLedger,
  ExternalRefRepository,
  IntegrationRunRepository,
  IntegrationSettings,
  IntegrationSettingsRepository,
  RunMode,
  RunStatus,
  RunTrigger,
} from '../domain/integration.repository';
import { SyncLease } from '../domain/sync-lease.port';
import { CredentialVault } from '../infrastructure/credential-vault';
import { InvoiceSyncService } from './invoice-sync.service';
import { SyncContext } from './sync-context';

const LEASE_KEY = 'integration:erp-sync';
/** a leitura incremental relê as últimas horas: os carimbos de alteração do ERP não são exactos ao segundo */
const DELTA_OVERLAP_MS = 2 * 60 * 60 * 1000;
const FULL_EVERY_MS = 24 * 60 * 60 * 1000;
const FAILURES_TO_ERROR = 3;
const MAX_PAGES = 2000;

class DryRunRollback extends Error {}

export interface RunRequest {
  trigger: RunTrigger;
  mode: RunMode;
  userId: number | null;
}

/**
 * Uma execução da sincronização:
 *   simulação → tudo dentro de UMA transacção desfeita no fim (mostra o que faria, não grava nada);
 *   real      → página a página, cada uma na sua transacção; o cursor só avança no fim com sucesso.
 * Ordem (completa): ligar facturas já existentes → facturas em aberto do ERP → varredura das que deixaram de vir.
 * No fim de uma execução real corre o pipeline de cobrança (vencidas → processos → carteiras).
 */
@Injectable()
export class RunSyncUseCase {
  private readonly logger = new Logger('IntegrationSync');

  constructor(
    private readonly settingsRepo: IntegrationSettingsRepository,
    private readonly runs: IntegrationRunRepository,
    private readonly refs: ExternalRefRepository,
    private readonly ledger: CollectionLedger,
    private readonly factory: ErpConnectorFactory,
    private readonly vault: CredentialVault,
    private readonly lease: SyncLease,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    private readonly notifications: NotificationPublisher,
    private readonly sync: InvoiceSyncService,
    private readonly markOverdue: MarkOverdueInvoicesUseCase,
    private readonly generateProcesses: GenerateCollectionProcessesUseCase,
    private readonly assignWallets: AssignWalletProcessesUseCase,
  ) {}

  /** pedido manual: valida, reserva e devolve logo o id; a execução continua em segundo plano */
  async launch(req: RunRequest): Promise<{ runId: number }> {
    const { settings, release } = await this.prepare(req);
    const runId = await this.runs.start({ trigger: req.trigger, mode: req.mode, provider: settings.provider, triggeredById: req.userId });
    const ctx = RequestContext.get();
    void RequestContext.run({ ...(ctx ?? {}), requestId: `integration-run:${runId}` }, () => this.execute(runId, settings, req, release));
    return { runId };
  }

  /** agendador: corre e espera; sem nada a fazer devolve null */
  async runScheduled(): Promise<{ runId: number; status: RunStatus } | null> {
    const s = await this.settingsRepo.get();
    if (s.status !== 'ACTIVE') return null;
    if (s.nextRunAt && s.nextRunAt.getTime() > Date.now()) return null;
    const mode: RunMode = !s.lastFullRunAt || Date.now() - s.lastFullRunAt.getTime() > FULL_EVERY_MS || !s.cursors.invoices ? 'FULL' : 'DELTA';
    let prepared: Awaited<ReturnType<RunSyncUseCase['prepare']>>;
    try {
      prepared = await this.prepare({ trigger: 'SCHEDULE', mode, userId: null });
    } catch (e) {
      if (e instanceof ConflictError) return null; // outra réplica já está a correr
      throw e;
    }
    const runId = await this.runs.start({ trigger: 'SCHEDULE', mode, provider: prepared.settings.provider, triggeredById: null });
    const status = await this.execute(runId, prepared.settings, { trigger: 'SCHEDULE', mode, userId: null }, prepared.release);
    return { runId, status };
  }

  private async prepare(req: RunRequest): Promise<{ settings: IntegrationSettings; release: () => Promise<void> }> {
    const settings = await this.settingsRepo.get();
    if (req.mode !== 'DRY_RUN' && settings.status !== 'ACTIVE') {
      throw new BusinessRuleError('A integração não está activa. Active-a, ou corra uma simulação.');
    }
    const release = await this.lease.tryAcquire(LEASE_KEY);
    if (!release) throw new ConflictError('Já está a decorrer uma sincronização com o ERP. Aguarde que termine.');
    try {
      await this.runs.failStale();
    } catch (e) {
      await release();
      throw e;
    }
    return { settings, release };
  }

  private async execute(runId: number, settings: IntegrationSettings, req: RunRequest, release: () => Promise<void>): Promise<RunStatus> {
    const dryRun = req.mode === 'DRY_RUN';
    const startedAt = new Date();
    let ctx: SyncContext | null = null;
    let status: RunStatus = 'FAILED';
    let error: string | null = null;
    try {
      const credentials = settings.credentialsEnc ? this.vault.decrypt(settings.credentialsEnc) : null;
      const connector = this.factory.create(settings.provider, settings.config, credentials);
      ctx = new SyncContext(
        runId,
        dryRun,
        settings,
        connector,
        new Map(settings.companies.map((c) => [c.companyCode, c.organizationId])),
        await this.ledger.currencyIds(),
        startedAt,
      );
      const full = req.mode !== 'DELTA' || !settings.cursors.invoices;
      if (dryRun) {
        try {
          await this.uow.run(async () => {
            await this.steps(ctx!, true);
            throw new DryRunRollback();
          });
        } catch (e) {
          if (!(e instanceof DryRunRollback)) throw e;
        }
      } else {
        await this.steps(ctx, full);
        await this.settingsRepo.saveCursor('invoices', new Date(startedAt.getTime() - 1000).toISOString());
        await this.runPipeline(ctx);
      }
      status = ctx.counters.reviewsOpened ? 'PARTIAL' : 'SUCCESS';
      if (!dryRun) await this.afterSuccess(settings, full, ctx);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.logger.error({ runId, err: e }, 'Sincronização com o ERP falhou');
      if (!dryRun) await this.afterFailure(settings, error).catch((x) => this.logger.error({ err: x }, 'Falha ao registar o insucesso'));
    } finally {
      await this.runs
        .finish(runId, { status, counters: ctx?.counters ?? {}, report: ctx?.report ?? [], error })
        .catch((x) => this.logger.error({ runId, err: x }, 'Falha ao fechar o registo da execução'));
      await release();
    }
    this.logger.log({ runId, mode: req.mode, status, counters: ctx?.counters, durationMs: Date.now() - startedAt.getTime() }, 'Sincronização com o ERP terminada');
    return status;
  }

  /** cada empresa do ERP ainda sem credor passa a ser um credor novo; as que já têm ficam como estão */
  private async loadCreditors(ctx: SyncContext): Promise<void> {
    const found = await ctx.connector.companies();
    const fresh = found.filter((c) => c.code && !ctx.companies.has(c.code));
    if (!fresh.length) return;
    const create = () => this.settingsRepo.createCreditors(fresh.map((c) => ({ companyCode: c.code, name: c.name, email: c.email, phone: c.phone, address: c.address })));
    const created = ctx.dryRun ? await create() : await this.uow.run(create);
    for (const [code, id] of created) ctx.companies.set(code, id);
    ctx.count('creditorsCreated', created.size);
    for (const c of fresh) ctx.log({ externalId: c.code, action: 'CREATE_CREDITOR', message: `Credor "${c.name}" criado a partir da empresa ${c.code} do ERP.` }, true);
  }

  private async steps(ctx: SyncContext, full: boolean): Promise<void> {
    await this.loadCreditors(ctx);
    if (full) {
      await this.linkExisting(ctx);
      await this.readAll(ctx, null);
      await this.sweepUnseen(ctx);
    } else {
      const since = new Date(new Date(ctx.settings.cursors.invoices).getTime() - DELTA_OVERLAP_MS).toISOString();
      await this.readAll(ctx, since);
    }
  }

  /** facturas do Cobraqui ainda sem ligação: procura-as no ERP pelo número */
  private async linkExisting(ctx: SyncContext): Promise<void> {
    let afterId = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.ledger.unlinkedOpenInvoices(afterId, 200);
      if (!batch.length) return;
      afterId = batch[batch.length - 1].invoiceId;
      const found = await ctx.connector.invoicesByReference(batch.map((b) => b.reference));
      ctx.count('linkCandidates', batch.length);
      await this.sync.processPage(ctx, found);
    }
  }

  private async readAll(ctx: SyncContext, since: string | null): Promise<void> {
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await ctx.connector.invoicesChangedSince(since, token);
      await this.sync.processPage(ctx, res.items);
      if (!res.next) return;
      token = res.next;
    }
    throw new Error(`Leitura interrompida: mais de ${MAX_PAGES} páginas numa execução`);
  }

  /** o que o ERP dizia estar em aberto e não veio na leitura completa: pergunta-se uma a uma (pagas, anuladas ou apagadas) */
  private async sweepUnseen(ctx: SyncContext): Promise<void> {
    for (let page = 0; page < MAX_PAGES; page++) {
      const ids = await this.refs.openInvoicesNotSeenSince(ctx.startedAt, 200);
      const pending = ids.filter((x) => !ctx.handled.has(x));
      if (!pending.length) return;
      const found = await ctx.connector.invoicesByIds(pending);
      await this.sync.processPage(ctx, found);
      const foundIds = new Set(found.map((f) => f.externalId));
      await this.sync.processMissing(ctx, pending.filter((x) => !foundIds.has(x)));
    }
  }

  private async runPipeline(ctx: SyncContext): Promise<void> {
    if (!ctx.counters.invoicesCreated) return;
    for (const [name, fn] of [
      ['markOverdue', () => this.markOverdue.execute()],
      ['generateProcesses', () => this.generateProcesses.execute()],
      ['assignWallets', () => this.assignWallets.execute()],
    ] as const) {
      try {
        await fn();
      } catch (e) {
        ctx.log({ action: 'PIPELINE_ERROR', message: `${name}: ${e instanceof Error ? e.message : String(e)}` }, true);
      }
    }
  }

  private async afterSuccess(settings: IntegrationSettings, full: boolean, ctx: SyncContext): Promise<void> {
    await this.settingsRepo.recordOutcome({ ok: true, full, nextRunAt: new Date(Date.now() + settings.intervalMinutes * 60_000) });
    const opened = ctx.counters.reviewsOpened ?? 0;
    if (opened) {
      const managers = await this.ledger.integrationManagers();
      await this.notifications.publish(
        managers.map((userId) => ({
          userId,
          type: 'integration.review_required',
          title: 'Casos da integração para rever',
          message: `A sincronização com o ERP deixou ${opened} caso(s) para decidir (pagos com acordo activo, valores alterados, devedores incompletos…).`,
          data: { runId: ctx.runId, opened },
          actionUrl: '/integration/reviews',
        })),
      );
    }
    await this.audit.record({ action: 'INTEGRATION_SYNC', entity: 'integration_run', entityId: ctx.runId, payload: { counters: ctx.counters } });
  }

  private async afterFailure(settings: IntegrationSettings, error: string): Promise<void> {
    const failures = await this.settingsRepo.recordOutcome({ ok: false, full: false, nextRunAt: new Date(Date.now() + settings.intervalMinutes * 60_000) });
    if (failures !== FAILURES_TO_ERROR) return;
    await this.settingsRepo.setStatus('ERROR', null);
    const managers = await this.ledger.integrationManagers();
    await this.notifications.publish(
      managers.map((userId) => ({
        userId,
        type: 'integration.failed',
        title: 'Integração com o ERP parada',
        message: `A sincronização com o ERP falhou ${FAILURES_TO_ERROR} vezes seguidas e foi suspensa. Último erro: ${error.slice(0, 300)}`,
        priority: 'high' as const,
        actionUrl: '/integration',
      })),
    );
  }
}
