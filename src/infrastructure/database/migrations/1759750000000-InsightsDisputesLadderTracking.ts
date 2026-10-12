import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Painel (índices), resolução de facturas em disputa e cumprimento dos passos da régua. */
export class InsightsDisputesLadderTracking1759750000000 implements MigrationInterface {
  name = 'InsightsDisputesLadderTracking1759750000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'insights-disputes-ladder-tracking.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX IF EXISTS ix_ladder_exec_agent, ix_ladder_exec_open, ix_payments_confirmed_paid_on, ix_processes_start_date;
      ALTER TABLE collection_ladder_executions
        DROP CONSTRAINT IF EXISTS ck_ladder_exec_tracking, DROP CONSTRAINT IF EXISTS ck_ladder_exec_fulfilled,
        DROP COLUMN IF EXISTS agent_id, DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS due_on, DROP COLUMN IF EXISTS fulfilled_at,
        DROP COLUMN IF EXISTS fulfilled_contact_id, DROP COLUMN IF EXISTS fulfilled_late, DROP COLUMN IF EXISTS escalated_at;
      ALTER TABLE collection_ladder_steps DROP COLUMN IF EXISTS fulfillment_days;
      DROP TABLE IF EXISTS invoice_disputes;
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE slug IN ('dashboard_view_all_permission','invoice_dispute_resolve_permission'));
      DELETE FROM permissions WHERE slug IN ('dashboard_view_all_permission','invoice_dispute_resolve_permission');
    `);
  }
}
