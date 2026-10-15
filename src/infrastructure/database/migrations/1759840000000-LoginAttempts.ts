import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bloqueio de conta contra credential stuffing. A chave é o hash do email (existindo ou não),
 * por isso o bloqueio não revela que contas existem; vive na BD para valer com várias réplicas da API.
 */
export class LoginAttempts1759840000000 implements MigrationInterface {
  name = 'LoginAttempts1759840000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        key_hash         text PRIMARY KEY,
        failures         int NOT NULL DEFAULT 0,
        last_failure_at  timestamptz NOT NULL DEFAULT now(),
        locked_until     timestamptz
      );
      CREATE INDEX IF NOT EXISTS ix_login_attempts_last_failure ON login_attempts (last_failure_at);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS login_attempts');
  }
}
