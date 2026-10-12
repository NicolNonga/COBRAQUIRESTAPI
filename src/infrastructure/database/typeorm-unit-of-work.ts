import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { TxOptions, UnitOfWork } from '@/shared/application/unit-of-work.port';
import { txStorage } from './transaction-context';

const RETRYABLE_PG_CODES = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

@Injectable()
export class TypeOrmUnitOfWork extends UnitOfWork {
  private readonly logger = new Logger(TypeOrmUnitOfWork.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async run<T>(work: () => Promise<T>, options: TxOptions = {}): Promise<T> {
    // Propagação: se já existe transacção, participa nela (REQUIRED).
    if (txStorage.getStore()) return work();

    const isolation = options.isolation ?? 'READ COMMITTED';
    const maxAttempts = 1 + (options.retries ?? (isolation === 'SERIALIZABLE' ? 3 : 0));

    for (let attempt = 1; ; attempt++) {
      const effects: Array<() => void | Promise<void>> = [];
      try {
        const result = await this.dataSource.transaction(isolation, (manager) =>
          txStorage.run({ manager, afterCommit: effects }, work),
        );
        await this.flush(effects);
        return result;
      } catch (err) {
        const code = err instanceof QueryFailedError ? (err.driverError as { code?: string })?.code : undefined;
        if (code && RETRYABLE_PG_CODES.has(code) && attempt < maxAttempts) {
          const backoff = 20 * 2 ** attempt + Math.floor(Math.random() * 20);
          this.logger.warn({ code, attempt, backoff }, 'Transacção abortada por concorrência; nova tentativa');
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw err;
      }
    }
  }

  afterCommit(effect: () => void | Promise<void>): void {
    const store = txStorage.getStore();
    if (store) store.afterCommit.push(effect);
    else void this.flush([effect]);
  }

  private async flush(effects: Array<() => void | Promise<void>>): Promise<void> {
    for (const effect of effects) {
      try {
        await effect();
      } catch (e) {
        // efeitos pós-commit nunca devem desfazer/afectar a operação já confirmada
        this.logger.error({ err: e }, 'Falha num efeito pós-commit');
      }
    }
  }
}
