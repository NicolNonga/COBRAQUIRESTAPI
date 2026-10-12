import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Histórico de contactos (N por processo) + resumo do último contacto no processo. */
export class ContactHistory1759710000000 implements MigrationInterface {
  name = 'ContactHistory1759710000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'contact-history.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    // não reintroduz o índice único: com histórico já gravado falharia
    await q.query(`
      DROP INDEX IF EXISTS ix_processes_open_last_contact, ix_contacts_process_contacted, ix_contacts_user_contacted;
      ALTER TABLE processes DROP COLUMN IF EXISTS last_contact_at, DROP COLUMN IF EXISTS last_contact_status, DROP COLUMN IF EXISTS contacts_count;
      ALTER TABLE contacts DROP COLUMN IF EXISTS contacted_at;
    `);
  }
}
