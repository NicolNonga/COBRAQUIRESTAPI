import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { TrackLadderTasksUseCase } from '@/modules/collection-ladders/application/ladder-tracking.use-cases';
import { RunCollectionLaddersUseCase } from '@/modules/collection-ladders/application/run-ladders.use-case';
import { AutoBreakNegotiationsUseCase } from '@/modules/negotiations/application/negotiation-lifecycle.use-cases';
import { MarkOverdueInvoicesUseCase } from '@/modules/invoices/application/mark-overdue-invoices.use-case';
import { PurgeOldNotificationsUseCase } from '@/modules/notifications/application/notification.use-cases';
import { AssignWalletProcessesUseCase } from '@/modules/processes/application/assignment.use-cases';
import { GenerateCollectionProcessesUseCase } from '@/modules/processes/application/generate-collection-processes.use-case';
import { ReturnTemporaryTransfersUseCase } from '@/modules/processes/application/transfer-processes.use-case';
import { RunSyncUseCase } from '@/modules/integrations/application/run-sync.use-case';
import { DistributedLock } from '@/shared/application/distributed-lock.port';
import { RequestContext } from '@/shared/application/request-context';
import { randomUUID } from 'node:crypto';

/**
 * Jobs de cobrança. Diferenças face ao `node-cron` do original (a cada minuto, sem lock):
 *  - lock distribuído (pg advisory lock): N réplicas ≠ N execuções concorrentes;
 *  - reentrância bloqueada: se uma execução demora mais que o intervalo, a seguinte salta;
 *  - pipeline ordenado (vencidas → processos → atribuição) com erros isolados e logados;
 *  - cada passo é atómico e idempotente.
 */
@Injectable()
export class CollectionJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly jobs: CronJob[] = [];
  private readonly logger = new Logger('Jobs');
  private readonly running = new Set<string>();

  constructor(
    private readonly cfg: ConfigService,
    private readonly lock: DistributedLock,
    private readonly markOverdue: MarkOverdueInvoicesUseCase,
    private readonly generate: GenerateCollectionProcessesUseCase,
    private readonly assignWallets: AssignWalletProcessesUseCase,
    private readonly returnTransfers: ReturnTemporaryTransfersUseCase,
    private readonly purgeNotifications: PurgeOldNotificationsUseCase,
    private readonly runLadders: RunCollectionLaddersUseCase,
    private readonly autoBreak: AutoBreakNegotiationsUseCase,
    private readonly trackLadder: TrackLadderTasksUseCase,
    private readonly integrationSync: RunSyncUseCase,
  ) {}

  /**
   * Modo de teste: JOBS_EVERY_SECONDS=5 põe TODOS os jobs a correr a cada 5 segundos
   * (ignora os CRON_*). Nunca activo em produção.
   */
  private everySeconds(): number | null {
    const n = Number(this.cfg.get('JOBS_EVERY_SECONDS') ?? 0);
    if (!n) return null;
    if (this.cfg.get('NODE_ENV') === 'production') {
      this.logger.warn('JOBS_EVERY_SECONDS ignorado em produção; a usar os horários CRON_*');
      return null;
    }
    return n;
  }

  private schedule(key: string, fallback: string): string {
    const n = this.everySeconds();
    return n ? `*/${n} * * * * *` : this.cfg.get(key, fallback);
  }

  onModuleInit(): void {
    if (this.cfg.get('NODE_ENV') === 'test') return;
    const n = this.everySeconds();
    if (n) this.logger.warn(`MODO DE TESTE: todos os jobs correm a cada ${n} segundos (JOBS_EVERY_SECONDS). Retire esta variável fora de testes.`);
    this.register('collection-pipeline', this.schedule('CRON_INVOICE_OVERDUE', '*/5 * * * *'), async () => {
      await this.step('invoices.mark-overdue', () => this.markOverdue.execute());
      await this.step('processes.generate', () => this.generate.execute());
      await this.step('processes.assign-wallets', () => this.assignWallets.execute());
    });
    this.register('transfers.return-temporary', this.schedule('CRON_TEMP_TRANSFER_RETURN', '*/10 * * * *'), () =>
      this.step('transfers.return-temporary', () => this.returnTransfers.execute()),
    );
    // régua de cobrança: diária, depois do pipeline (processos novos já gerados e atribuídos)
    this.register('collection-ladders', this.schedule('CRON_COLLECTION_LADDERS', '50 7 * * *'), () =>
      this.step('collection-ladders.run', () => this.runLadders.execute()),
    );
    // cumprimento dos passos da régua (contacto registado → cumprido; prazo ultrapassado → escala ao gestor)
    this.register('collection-ladders.tracking', this.schedule('CRON_LADDER_TRACKING', '*/15 * * * *'), () =>
      this.step('collection-ladders.tracking', () => this.trackLadder.execute()),
    );
    // quebra automática de acordos (só actua se NEGOTIATION_AUTO_BREAK_ENABLED=true)
    this.register('negotiations.auto-break', this.schedule('CRON_NEGOTIATION_AUTO_BREAK', '15 7 * * *'), () =>
      this.step('negotiations.auto-break', () => this.autoBreak.execute()),
    );
    // integração com o ERP: verifica a cada 5 min se chegou a hora (o intervalo real é o da configuração).
    // Sem `step`: a sincronização grava página a página e tem o seu próprio lock (não pode correr numa só transacção).
    this.register('integrations.sync', this.schedule('CRON_INTEGRATION_SYNC', '*/5 * * * *'), async () => {
      const started = Date.now();
      try {
        const r = await this.integrationSync.runScheduled();
        if (r) this.logger.log({ job: 'integrations.sync', ...r, durationMs: Date.now() - started }, 'Job concluído');
      } catch (err) {
        this.logger.error({ job: 'integrations.sync', err, durationMs: Date.now() - started }, 'Job falhou');
      }
    });
    this.register('notifications.purge', this.schedule('CRON_NOTIFICATIONS_PURGE', '30 3 * * *'), () => this.step('notifications.purge', () => this.purgeNotifications.execute(30)));
  }

  onModuleDestroy(): void {
    this.jobs.forEach((j) => j.stop()); // shutdown gracioso
  }

  private register(name: string, expr: string, fn: () => Promise<void>): void {
    const job = CronJob.from({
      cronTime: expr,
      timeZone: 'Africa/Luanda',
      onTick: async () => {
        if (this.running.has(name)) return this.logger.warn({ job: name }, 'Execução anterior ainda a decorrer; a saltar');
        this.running.add(name);
        try {
          await RequestContext.run({ requestId: `job:${name}:${randomUUID()}` }, fn);
        } finally {
          this.running.delete(name);
        }
      },
    });
    this.jobs.push(job);
    job.start();
    this.logger.log({ job: name, cron: expr }, 'Job agendado');
  }

  private async step(name: string, work: () => Promise<unknown>): Promise<void> {
    const started = Date.now();
    try {
      const { acquired, result } = await this.lock.tryWithLock(`job:${name}`, work);
      if (!acquired) return this.logger.debug({ job: name }, 'Lock ocupado por outra instância');
      this.logger.log({ job: name, result, durationMs: Date.now() - started }, 'Job concluído');
    } catch (err) {
      this.logger.error({ job: name, err, durationMs: Date.now() - started }, 'Job falhou');
    }
  }
}
