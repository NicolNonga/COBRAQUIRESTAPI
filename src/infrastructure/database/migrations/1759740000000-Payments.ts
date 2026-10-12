import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Pagamentos (A/B), alocação, crédito do devedor, conta-corrente por credor, acertos e meios de pagamento. */
export class Payments1759740000000 implements MigrationInterface {
  name = 'Payments1759740000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'payments.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS creditor_ledger_entries, creditor_settlements, debtor_credit_entries, payment_allocations, payments, payment_methods;
      DROP FUNCTION IF EXISTS forbid_delete();
      ALTER TABLE organizations DROP COLUMN IF EXISTS commission_rate;
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE slug IN
        ('payment_confirm_permission','payment_method_manage_permission','creditor_settlement_permission','creditor_commission_manage_permission'));
      DELETE FROM permissions WHERE slug IN
        ('payment_confirm_permission','payment_method_manage_permission','creditor_settlement_permission','creditor_commission_manage_permission');
    `);
  }
}
