import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema inicial (PostgreSQL). O SQL fica em `schema.sql` para ser revisto
 * como SQL puro (índices parciais, CHECKs e triggers que o gerador do TypeORM
 * não exprime bem). Executado numa única transacção pela CLI do TypeORM.
 */
export class InitialSchema1759680000000 implements MigrationInterface {
  name = 'InitialSchema1759680000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS idempotency_keys, audit_logs, notifications, negotiation_installments,
        negotiation_processes, negotiations, contacts, process_transfers, process_assignments,
        process_invoices, processes, invoices, user_wallets, debtor_contact_persons, debtors,
        password_reset_tokens, wallet_agents, users, organizations, role_permissions, roles,
        permissions, process_states, invoice_states, contact_types, debtor_types, currencies,
        categories CASCADE;
      DROP FUNCTION IF EXISTS audit_logs_immutable();
    `);
  }
}
