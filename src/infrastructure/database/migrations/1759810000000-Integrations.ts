import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Integração com o ERP (SAP): configuração única, execuções, referências externas e fila de revisão. */
export class Integrations1759810000000 implements MigrationInterface {
  name = 'Integrations1759810000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'integrations.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS integration_review_items, external_refs, integration_runs, integration_company_creditors, integration_settings;
      ALTER TABLE processes DROP COLUMN IF EXISTS closed_reason;
    `);
  }
}
