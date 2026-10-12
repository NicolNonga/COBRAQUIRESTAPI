import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Garante a regra dos quatro olhos nos pagamentos: quem registou não confirma.
 * Idempotente — serve tanto para bases onde o CHECK nunca saiu como para bases
 * onde foi removido. Os dados que violem a regra são corrigidos antes (não há:
 * o CHECK esteve sempre activo), por isso a criação é segura.
 */
export class PaymentFourEyes1759830000000 implements MigrationInterface {
  name = 'PaymentFourEyes1759830000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_four_eyes');
    await q.query(`
      ALTER TABLE payments ADD CONSTRAINT ck_payments_four_eyes
        CHECK (confirmed_by_id IS NULL OR confirmed_by_id <> registered_by_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_four_eyes');
  }
}
