import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '../database/base.repository';
import { OutboxMessageOrmEntity, OutboxStatus } from './outbox-message.orm-entity';

export interface ClaimedMessage {
  id: string;
  type: string;
  payload: unknown;
  encrypted: boolean;
  attempts: number;
  maxAttempts: number;
  requestId: string | null;
  createdAt: Date;
}

/** Operações SQL da fila (claim / ack / nack / inbox). Todas com fencing por `locked_by`. */
@Injectable()
export class OutboxStore extends BaseTypeOrmRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  /**
   * Reserva um lote: FOR UPDATE SKIP LOCKED → N workers/réplicas nunca pegam a mesma mensagem.
   * Também recupera mensagens cujo lease expirou (worker que morreu a meio).
   */
  claim(workerId: string, batchSize: number, leaseSeconds: number, skipTypes: string[] = []): Promise<ClaimedMessage[]> {
    return this.manager.query(
      `UPDATE outbox_messages o
          SET status = 'PROCESSING', locked_by = $1,
              locked_until = now() + make_interval(secs => $3), attempts = o.attempts + 1
        WHERE o.id IN (
          SELECT id FROM outbox_messages
           WHERE ((status = 'PENDING' AND available_at <= now())
              OR (status = 'PROCESSING' AND locked_until < now()))
             AND NOT (type = ANY($4::text[]))   -- tipos cuja dependência tem o circuito aberto
           ORDER BY available_at, id
           LIMIT $2
           FOR UPDATE SKIP LOCKED)
        RETURNING o.id, o.type, o.payload, o.encrypted, o.attempts, o.max_attempts AS "maxAttempts",
                  o.request_id AS "requestId", o.created_at AS "createdAt"`,
      [workerId, batchSize, leaseSeconds, skipTypes],
    ).then((r: unknown[]) => (Array.isArray(r[0]) ? (r[0] as ClaimedMessage[]) : (r as ClaimedMessage[])));
  }

  async processedHandlers(messageId: string): Promise<Set<string>> {
    const rows: Array<{ handler: string }> = await this.manager.query('SELECT handler FROM inbox_messages WHERE message_id = $1', [messageId]);
    return new Set(rows.map((r) => r.handler));
  }

  /** INSERT na inbox. false = já processado (outra execução ganhou) → o chamador deve abortar/ignorar. */
  async markHandled(messageId: string, handler: string): Promise<boolean> {
    const rows: unknown[] = await this.manager.query(
      `INSERT INTO inbox_messages (message_id, handler) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING message_id`,
      [messageId, handler],
    );
    return rows.length > 0;
  }

  /** Sucesso. Payload sensível é apagado (minimização de dados). */
  async ack(id: string, workerId: string): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE outbox_messages
          SET status = 'SENT', processed_at = now(), locked_by = NULL, locked_until = NULL, last_error = NULL,
              payload = CASE WHEN encrypted THEN NULL ELSE payload END
        WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'`,
      [id, workerId],
    );
    return n > 0;
  }

  /** Falha: reagenda com backoff ou move para DEAD (dead-letter). */
  async nack(id: string, workerId: string, error: string, retryAt: Date | null): Promise<OutboxStatus | null> {
    const res = await this.manager.query(
      `UPDATE outbox_messages
          SET status = CASE WHEN $4::timestamptz IS NULL THEN 'DEAD' ELSE 'PENDING' END,
              available_at = COALESCE($4::timestamptz, available_at),
              last_error = left($3, 4000), locked_by = NULL, locked_until = NULL,
              processed_at = CASE WHEN $4::timestamptz IS NULL THEN now() ELSE NULL END
        WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'
        RETURNING status`,
      [id, workerId, error, retryAt],
    );
    const rows: Array<{ status: OutboxStatus }> = Array.isArray(res[0]) ? res[0] : res;
    return rows[0]?.status ?? null;
  }

  /**
   * Circuito aberto: devolve a mensagem à fila para `availableAt` SEM gastar a tentativa
   * (a falha é da dependência, não da mensagem).
   */
  async defer(id: string, workerId: string, availableAt: Date, reason: string): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE outbox_messages
          SET status = 'PENDING', available_at = $3, attempts = GREATEST(attempts - 1, 0),
              last_error = left($4, 4000), locked_by = NULL, locked_until = NULL
        WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'`,
      [id, workerId, availableAt, reason],
    );
    return n > 0;
  }

  /** prolonga o lease de mensagens lentas (evita que outro worker as retome a meio) */
  async extendLease(id: string, workerId: string, leaseSeconds: number): Promise<void> {
    await this.manager.query(
      `UPDATE outbox_messages SET locked_until = now() + make_interval(secs => $3)
        WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'`,
      [id, workerId, leaseSeconds],
    );
  }

  // ---------------- administração ----------------

  async stats(): Promise<Record<string, number>> {
    const rows: Array<{ status: string; n: number }> = await this.manager.query(
      'SELECT status, count(*)::int AS n FROM outbox_messages GROUP BY status',
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  async page(status: OutboxStatus | undefined, type: string | undefined, limit: number, offset: number) {
    const qb = this.repo(OutboxMessageOrmEntity)
      .createQueryBuilder('o')
      .select(['o.id', 'o.type', 'o.status', 'o.attempts', 'o.maxAttempts', 'o.availableAt', 'o.lastError', 'o.requestId', 'o.createdAt', 'o.processedAt', 'o.encrypted'])
      .orderBy('o.created_at', 'DESC')
      .take(limit)
      .skip(offset);
    if (status) qb.andWhere('o.status = :status', { status });
    if (type) qb.andWhere('o.type = :type', { type });
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  /** DEAD → PENDING (reprocessamento manual após corrigir a causa). */
  async retry(ids: string[]): Promise<number> {
    const [, n] = await this.manager.query(
      `UPDATE outbox_messages SET status = 'PENDING', attempts = 0, available_at = now(), last_error = NULL, processed_at = NULL
        WHERE id = ANY($1::uuid[]) AND status = 'DEAD' AND (payload IS NOT NULL)`,
      [ids],
    );
    return n;
  }

  async purge(sentOlderThanDays: number, inboxOlderThanDays: number): Promise<{ outbox: number; inbox: number }> {
    const [, outbox] = await this.manager.query(
      `DELETE FROM outbox_messages WHERE status = 'SENT' AND processed_at < now() - make_interval(days => $1)`,
      [sentOlderThanDays],
    );
    const [, inbox] = await this.manager.query(
      `DELETE FROM inbox_messages WHERE processed_at < now() - make_interval(days => $1)`,
      [inboxOlderThanDays],
    );
    return { outbox, inbox };
  }
}
