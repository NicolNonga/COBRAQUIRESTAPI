import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Régua master (política de cobrança geral) + marcação de conformidade das réguas filhas. */
export class CollectionPolicies1759800000000 implements MigrationInterface {
  name = 'CollectionPolicies1759800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'collection-policies.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE processes DROP COLUMN IF EXISTS policy_limit_notified_at;
      ALTER TABLE collection_ladders DROP COLUMN IF EXISTS policy_version, DROP COLUMN IF EXISTS policy_compliant, DROP COLUMN IF EXISTS policy_violations;
      DROP TABLE IF EXISTS collection_policy_step_rules, collection_policies;
    `);
  }
}
