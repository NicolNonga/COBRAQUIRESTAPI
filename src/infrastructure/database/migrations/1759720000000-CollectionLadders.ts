import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Régua de cobrança dinâmica (por comercial) + execuções idempotentes. */
export class CollectionLadders1759720000000 implements MigrationInterface {
  name = 'CollectionLadders1759720000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'collection-ladders.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS collection_ladder_executions, collection_ladder_steps, collection_ladders;
      DROP INDEX IF EXISTS ix_processes_open_start;
    `);
  }
}
