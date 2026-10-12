import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Outbox, OutboxMessageInput } from '@/shared/application/outbox.port';
import { RequestContext } from '@/shared/application/request-context';
import { BaseTypeOrmRepository } from '../database/base.repository';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';
import { PayloadCipher } from './payload-cipher';

@Injectable()
export class TypeOrmOutbox extends BaseTypeOrmRepository implements Outbox {
  private readonly logger = new Logger('Outbox');

  constructor(@InjectDataSource() ds: DataSource, private readonly cipher: PayloadCipher) {
    super(ds);
  }

  enqueue<T>(message: OutboxMessageInput<T>): Promise<void> {
    return this.enqueueMany([message]);
  }

  async enqueueMany<T>(messages: OutboxMessageInput<T>[]): Promise<void> {
    if (!messages.length) return;
    if (!this.inTransaction()) {
      // Sem transacção a garantia de atomicidade perde-se: sinalizamos para corrigir o chamador.
      this.logger.warn({ types: messages.map((m) => m.type) }, 'enqueue fora de transacção — use UnitOfWork.run()');
    }
    const requestId = RequestContext.get()?.requestId ?? null;
    const rows = messages.map((m) => ({
      id: randomUUID(),
      type: m.type,
      payload: (m.sensitive ? this.cipher.encrypt(m.payload) : m.payload) as never,
      encrypted: !!m.sensitive,
      dedupKey: m.dedupKey ?? null,
      maxAttempts: m.maxAttempts ?? 10,
      availableAt: m.availableAt ?? new Date(),
      status: 'PENDING' as const,
      requestId,
    }));
    // ON CONFLICT DO NOTHING (dedup_key): re-execuções/retries do produtor não duplicam eventos
    const r = await this.repo(OutboxMessageOrmEntity).createQueryBuilder().insert().values(rows).orIgnore().returning(['id']).execute();
    const skipped = rows.length - (r.raw as unknown[]).length;
    if (skipped > 0) this.logger.debug({ skipped }, 'Mensagens deduplicadas');
  }
}
