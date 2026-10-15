import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lei 22/11 (art. 27.º oposição; arts. 18.º-19.º comunicações): registo de "não contactar" por devedor e canal.
 * Nunca se apaga: levantar a restrição guarda quem, quando e porquê (prova de cumprimento).
 */
export class DataProtection1759860000000 implements MigrationInterface {
  name = 'DataProtection1759860000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS debtor_contact_restrictions (
        id             serial PRIMARY KEY,
        debtor_id      int NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
        channel        varchar(5) NOT NULL CHECK (channel IN ('EMAIL','SMS','ALL')),
        source         varchar(20) NOT NULL CHECK (source IN ('DEBTOR_REQUEST','COMPLAINT','LEGAL','OTHER')),
        reason         text NOT NULL,
        created_by_id  int REFERENCES users(id) ON DELETE SET NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        lifted_at      timestamptz,
        lifted_by_id   int REFERENCES users(id) ON DELETE SET NULL,
        lift_reason    text,
        CONSTRAINT ck_dcr_lift CHECK ((lifted_at IS NULL) = (lift_reason IS NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_dcr_active ON debtor_contact_restrictions (debtor_id, channel) WHERE lifted_at IS NULL;
      CREATE INDEX IF NOT EXISTS ix_dcr_debtor ON debtor_contact_restrictions (debtor_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS debtor_contact_restrictions');
  }
}
