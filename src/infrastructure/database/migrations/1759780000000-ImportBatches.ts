import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Histórico de importações: cada ficheiro importado (credores, devedores, facturas, PDFs) fica registado
 * com o ficheiro original, o resultado e os erros linha a linha.
 */
export class ImportBatches1759780000000 implements MigrationInterface {
  name = 'ImportBatches1759780000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id                 serial PRIMARY KEY,
        kind               varchar(20)  NOT NULL CONSTRAINT ck_import_batches_kind CHECK (kind IN ('ORGANIZATIONS','DEBTORS','INVOICES','INVOICE_PDFS')),
        status             varchar(10)  NOT NULL CONSTRAINT ck_import_batches_status CHECK (status IN ('SUCCESS','PARTIAL','FAILED')),
        file_name          varchar(255) NOT NULL,
        file_size          int          NOT NULL DEFAULT 0,
        file_path          varchar(255),
        error_report_path  varchar(255),
        total              int          NOT NULL DEFAULT 0,
        imported           int          NOT NULL DEFAULT 0,
        failed             int          NOT NULL DEFAULT 0,
        errors             jsonb        NOT NULL DEFAULT '[]'::jsonb,
        message            text,
        duration_ms        int,
        created_by_id      int REFERENCES users(id) ON DELETE SET NULL,
        created_at         timestamptz  NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ix_import_batches_created ON import_batches (created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS ix_import_batches_kind ON import_batches (kind, created_at DESC);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS import_batches;`);
  }
}
