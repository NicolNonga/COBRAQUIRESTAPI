import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Aprovação, quebra e renegociação de negociações (aditivo, não altera dados existentes). */
export class NegotiationLifecycle1759730000000 implements MigrationInterface {
  name = 'NegotiationLifecycle1759730000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'renegotiation.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX IF EXISTS ux_negotiations_previous, ix_negotiations_pending_approval, ix_negotiations_active;
      ALTER TABLE negotiations DROP CONSTRAINT IF EXISTS ck_negotiations_four_eyes, DROP CONSTRAINT IF EXISTS ck_negotiations_state_fields,
        DROP CONSTRAINT IF EXISTS ck_negotiations_status;
      ALTER TABLE negotiations DROP COLUMN IF EXISTS previous_negotiation_id, DROP COLUMN IF EXISTS authorized_by_id,
        DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS rejection_reason,
        DROP COLUMN IF EXISTS started_at, DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS broken_at,
        DROP COLUMN IF EXISTS broken_by_id, DROP COLUMN IF EXISTS break_reason, DROP COLUMN IF EXISTS renegotiated_at;
      ALTER TABLE negotiations ADD CONSTRAINT negotiations_status_check CHECK (status IN ('ACTIVE','CANCELLED','COMPLETED'));
    `);
  }
}
