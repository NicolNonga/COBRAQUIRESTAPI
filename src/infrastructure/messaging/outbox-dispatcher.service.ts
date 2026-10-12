import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PermanentMessageError } from '@/shared/application/message-handler';
import { DistributedLock } from '@/shared/application/distributed-lock.port';
import { RequestContext } from '@/shared/application/request-context';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { CircuitBreakerRegistry } from '../resilience/circuit-breaker.registry';
import { CircuitOpenError } from '../resilience/circuit-breaker';
import { HandlerRegistry, RegisteredHandler } from './handler-registry';
import { ClaimedMessage, OutboxStore } from './outbox-store';
import { PayloadCipher } from './payload-cipher';
import { RetryPolicy } from './retry-policy';

interface PgPoolClient {
  query(sql: string): Promise<unknown>;
  on(event: 'notification' | 'error', cb: (...a: unknown[]) => void): void;
  release(err?: boolean): void;
}

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout de ${ms}ms no handler ${label}`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

/**
 * Dispatcher da outbox (job contínuo).
 *  - acorda por LISTEN/NOTIFY logo após cada COMMIT + polling de segurança;
 *  - reserva lotes com SKIP LOCKED (escala horizontalmente: N réplicas = N workers);
 *  - lease com expiração + fencing por worker id (recuperação de crashes sem duplicar trabalho);
 *  - inbox por handler (idempotência do consumidor; fan-out com retry independente);
 *  - backoff exponencial com jitter, erros permanentes e dead-letter (DEAD) com alerta no log;
 *  - circuit breaker por dependência externa: circuito aberto → não reserva essas mensagens e,
 *    se já reservadas, devolve-as à fila sem gastar tentativas;
 *  - shutdown gracioso: termina o lote em curso antes de sair.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('OutboxDispatcher');
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly retry = new RetryPolicy();
  private readonly pollMs: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly leaseSeconds: number;
  private readonly handlerTimeoutMs: number;
  private readonly enabled: boolean;

  private running = false;
  private wakeUp?: () => void;
  private loopDone?: Promise<void>;
  private listener?: PgPoolClient;
  private housekeeping?: NodeJS.Timeout;

  constructor(
    cfg: ConfigService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly store: OutboxStore,
    private readonly registry: HandlerRegistry,
    private readonly cipher: PayloadCipher,
    private readonly uow: UnitOfWork,
    private readonly lock: DistributedLock,
    private readonly circuits: CircuitBreakerRegistry,
  ) {
    this.pollMs = Number(cfg.get('OUTBOX_POLL_MS', 5000));
    this.batchSize = Number(cfg.get('OUTBOX_BATCH_SIZE', 50));
    this.concurrency = Number(cfg.get('OUTBOX_CONCURRENCY', 5));
    this.leaseSeconds = Number(cfg.get('OUTBOX_LEASE_SECONDS', 120));
    this.handlerTimeoutMs = Number(cfg.get('OUTBOX_HANDLER_TIMEOUT_MS', 30_000));
    this.enabled = String(cfg.get('OUTBOX_DISPATCHER_ENABLED', 'true')) === 'true' && cfg.get('NODE_ENV') !== 'test';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return this.logger.warn('Dispatcher da outbox desactivado nesta instância');
    this.running = true;
    await this.listen();
    this.loopDone = this.loop();
    this.housekeeping = setInterval(() => void this.cleanup(), 3_600_000);
    this.logger.log({ workerId: this.workerId, batch: this.batchSize, concurrency: this.concurrency }, 'Dispatcher da outbox iniciado');
  }

  /**
   * `beforeApplicationShutdown` corre ANTES de o TypeORM fechar o pool (`onApplicationShutdown`):
   * paramos o loop e esperamos o lote em curso enquanto a BD ainda está disponível.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.housekeeping);
    this.wakeUp?.();
    await this.loopDone;
    this.listener?.release();
    this.logger.log('Dispatcher da outbox parado');
  }

  // ------------------------------------------------------------------ loop

  private async loop(): Promise<void> {
    while (this.running) {
      let claimed = 0;
      try {
        claimed = await this.tick();
      } catch (err) {
        if (!this.running || !this.ds.isInitialized) break; // a encerrar: o pool já foi fechado
        this.logger.error({ err }, 'Falha no ciclo do dispatcher');
      }
      // lote cheio → provavelmente há mais trabalho; senão espera NOTIFY ou o timeout de polling
      if (claimed < this.batchSize && this.running) await this.sleep(this.pollMs);
    }
  }

  /** um ciclo: reservar e processar um lote; devolve quantas mensagens reservou */
  async tick(): Promise<number> {
    const skip = this.registry.typesBlockedBy(this.circuits.blocking(this.registry.circuits()));
    const batch = await this.store.claim(this.workerId, this.batchSize, this.leaseSeconds, skip);
    if (!batch.length) return 0;
    const queue = [...batch];
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      for (let m = queue.shift(); m; m = queue.shift()) await this.process(m);
    });
    await Promise.all(workers);
    return batch.length;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.wakeUp = done;
    });
  }

  // ------------------------------------------------------------------ processamento

  private async process(m: ClaimedMessage): Promise<void> {
    const started = Date.now();
    const log = { messageId: m.id, type: m.type, attempt: m.attempts };
    await RequestContext.run({ requestId: m.requestId ?? `outbox:${m.id}` }, async () => {
      try {
        const handlers = this.registry.handlersFor(m.type);
        if (!handlers.length) throw new PermanentMessageError(`Nenhum handler registado para '${m.type}'`);
        if (m.payload == null) throw new PermanentMessageError('Payload ausente');
        const payload = m.encrypted ? this.cipher.decrypt(m.payload as { data: string }) : m.payload;
        const envelope = { id: m.id, type: m.type, payload, attempts: m.attempts, createdAt: m.createdAt, requestId: m.requestId };

        const done = await this.store.processedHandlers(m.id);
        for (const h of handlers) {
          if (done.has(h.options.name)) continue; // já entregue numa tentativa anterior (inbox)
          if (h.options.transactional) {
            // exactly-once: registo inbox + efeitos do handler na MESMA transacção
            await this.uow.run(async () => {
              if (!(await this.store.markHandled(m.id, h.options.name))) return;
              await withTimeout(h.instance.handle(envelope), this.handlerTimeoutMs, h.options.name);
            });
          } else {
            // efeito externo: at-least-once; inbox gravada após sucesso para não repetir em retries
            await this.callExternal(h, () => withTimeout(h.instance.handle(envelope), this.handlerTimeoutMs, h.options.name));
            await this.store.markHandled(m.id, h.options.name);
          }
        }

        if (!(await this.store.ack(m.id, this.workerId))) {
          this.logger.warn(log, 'Lease perdido antes do ack (outro worker retomou a mensagem)');
          return;
        }
        this.logger.log({ ...log, durationMs: Date.now() - started }, 'Mensagem entregue');
      } catch (err) {
        await this.fail(m, err, Date.now() - started);
      }
    });
  }

  /** passa pelo circuito da dependência (se o handler declarar um); erros permanentes não abrem o circuito */
  private callExternal(h: RegisteredHandler, fn: () => Promise<void>): Promise<void> {
    if (!h.options.circuit) return fn();
    return this.circuits.get(h.options.circuit).execute(fn, (e) => !(e instanceof PermanentMessageError));
  }

  private async fail(m: ClaimedMessage, err: unknown, durationMs: number): Promise<void> {
    if (err instanceof CircuitOpenError) {
      // a dependência está em baixo: a mensagem não tem culpa → volta à fila sem gastar a tentativa
      await this.store.defer(m.id, this.workerId, err.retryAt, err.message);
      this.logger.debug({ messageId: m.id, type: m.type, circuit: err.circuit, retryAt: err.retryAt }, 'Mensagem adiada: circuito aberto');
      return;
    }
    const permanent = err instanceof PermanentMessageError;
    const exhausted = m.attempts >= m.maxAttempts;
    const retryAt = permanent || exhausted ? null : this.retry.nextAttemptAt(m.attempts);
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const status = await this.store.nack(m.id, this.workerId, message, retryAt);
    const log = { messageId: m.id, type: m.type, attempt: m.attempts, maxAttempts: m.maxAttempts, durationMs, error: message };
    if (status === 'DEAD') {
      // ALERTA: precisa de intervenção humana (ver GET /api/outbox?status=DEAD e POST /api/outbox/retry)
      this.logger.error({ ...log, alert: 'OUTBOX_DEAD_LETTER', permanent }, 'Mensagem movida para DEAD');
    } else if (status === 'PENDING') {
      this.logger.warn({ ...log, retryAt }, 'Falha na entrega; nova tentativa agendada');
    } else {
      this.logger.warn(log, 'Falha mas lease já não pertence a este worker');
    }
  }

  // ------------------------------------------------------------------ LISTEN/NOTIFY

  private async listen(): Promise<void> {
    try {
      const pool = (this.ds.driver as unknown as { master: { connect(): Promise<PgPoolClient> } }).master;
      this.listener = await pool.connect();
      this.listener.on('notification', () => this.wakeUp?.());
      this.listener.on('error', (err) => {
        if (!this.running) return;
        this.logger.warn({ err }, 'Ligação LISTEN perdida; a reconectar (polling continua activo)');
        this.listener?.release(true);
        this.listener = undefined;
        if (this.running) setTimeout(() => void this.listen(), 5_000);
      });
      await this.listener.query('LISTEN outbox_new');
    } catch (err) {
      this.logger.warn({ err }, 'LISTEN indisponível; a usar apenas polling');
    }
  }

  // ------------------------------------------------------------------ manutenção

  private async cleanup(): Promise<void> {
    const { acquired, result } = await this.lock.tryWithLock('outbox:cleanup', () => this.store.purge(7, 30));
    if (acquired) this.logger.log({ removed: result }, 'Limpeza da outbox/inbox');
    const stats = await this.store.stats();
    if ((stats.DEAD ?? 0) > 0) this.logger.error({ alert: 'OUTBOX_DEAD_LETTER', dead: stats.DEAD }, 'Existem mensagens em DEAD');
  }
}
