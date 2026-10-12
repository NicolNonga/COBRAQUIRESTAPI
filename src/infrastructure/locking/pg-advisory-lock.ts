import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DistributedLock } from '@/shared/application/distributed-lock.port';
import { txStorage } from '../database/transaction-context';

/**
 * Lock distribuído com `pg_try_advisory_xact_lock`: o lock é libertado
 * automaticamente no fim da transacção (sem risco de lock órfão se o processo morrer).
 */
@Injectable()
export class PgAdvisoryLock extends DistributedLock {
  private readonly logger = new Logger(PgAdvisoryLock.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async tryWithLock<T>(key: string, work: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
    const effects: Array<() => void | Promise<void>> = [];
    const outcome = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        [key],
      );
      if (!locked) return { acquired: false };
      const result = await txStorage.run({ manager, afterCommit: effects }, work);
      return { acquired: true, result };
    });
    for (const fx of effects) {
      try {
        await fx();
      } catch (e) {
        this.logger.error({ err: e }, 'Falha num efeito pós-commit');
      }
    }
    return outcome;
  }
}
