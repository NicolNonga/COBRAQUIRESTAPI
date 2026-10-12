import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** pg_trgm + unaccent + índices para os filtros dinâmicos das listagens. */
export class SearchIndexes1759700000000 implements MigrationInterface {
  name = 'SearchIndexes1759700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'search-indexes.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX IF EXISTS ix_debtors_name_trgm, ix_debtors_nif_trgm, ix_debtors_email_trgm, ix_organizations_name_trgm,
        ix_users_full_name_trgm, ix_users_email_trgm, ix_invoices_reference_trgm, ix_invoices_due_date, ix_invoices_issue_date,
        ix_invoices_debtor_due, ix_negotiations_effective, ix_processes_open_created;
      DROP FUNCTION IF EXISTS f_unaccent(text);
    `);
  }
}
