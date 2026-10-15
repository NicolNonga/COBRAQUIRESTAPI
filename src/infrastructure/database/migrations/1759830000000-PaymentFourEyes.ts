import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Garante a regra dos quatro olhos nos pagamentos: quem registou não confirma.
 * Idempotente — serve tanto para bases onde o CHECK nunca saiu como para bases
 * onde foi removido.
 *
 * Pagamentos antigos que já violem a regra NÃO são alterados (é dinheiro: a correcção
 * é decisão de quem audita). O CHECK entra como NOT VALID: vale para tudo o que for
 * inserido ou alterado a partir de agora; as linhas antigas ficam por rever. Depois de
 * as corrigir: ALTER TABLE payments VALIDATE CONSTRAINT ck_payments_four_eyes;
 */
export class PaymentFourEyes1759830000000 implements MigrationInterface {
  name = 'PaymentFourEyes1759830000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_four_eyes');
    await q.query(`
      ALTER TABLE payments ADD CONSTRAINT ck_payments_four_eyes
        CHECK (confirmed_by_id IS NULL OR confirmed_by_id <> registered_by_id) NOT VALID;
    `);
    const bad: Array<{ n: string }> = await q.query('SELECT count(*)::text AS n FROM payments WHERE confirmed_by_id = registered_by_id');
    if (Number(bad[0]?.n) > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[PaymentFourEyes] ${bad[0].n} pagamento(s) antigo(s) foram confirmados por quem os registou. Ficam por rever: SELECT id, registered_by_id, confirmed_by_id, created_at FROM payments WHERE confirmed_by_id = registered_by_id;`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_four_eyes');
  }
}
