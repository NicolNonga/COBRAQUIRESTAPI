import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SyncLease } from '../domain/sync-lease.port';

/**
 * `pg_try_advisory_lock` numa ligação dedicada, mantida durante a execução.
 * Se a API morrer, a ligação fecha e o PostgreSQL liberta o lock sozinho.
 */
@Injectable()
export class PgSessionLease extends SyncLease {
  private readonly logger = new Logger(PgSessionLease.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    super();
  }

  async tryAcquire(key: string): Promise<(() => Promise<void>) | null> {
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    try {
      const [{ locked }] = await qr.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key]);
      if (!locked) {
        await qr.release();
        return null;
      }
    } catch (e) {
      await qr.release();
      throw e;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await qr.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      } catch (e) {
        this.logger.warn({ err: e, key }, 'Falha ao libertar o lock da sincronização (a ligação fecha e liberta-o)');
      } finally {
        await qr.release();
      }
    };
  }
}
