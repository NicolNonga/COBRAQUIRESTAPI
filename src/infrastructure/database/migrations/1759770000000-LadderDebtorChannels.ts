import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Régua: cada passo pode também enviar uma mensagem ao DEVEDOR (email e/ou SMS),
 * com assunto e texto próprios (o texto interno continua a ser o alerta para agente/gestor).
 */
export class LadderDebtorChannels1759770000000 implements MigrationInterface {
  name = 'LadderDebtorChannels1759770000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE collection_ladder_steps
        ADD COLUMN IF NOT EXISTS debtor_channel varchar(10) NOT NULL DEFAULT 'NONE',
        ADD COLUMN IF NOT EXISTS debtor_subject varchar(150),
        ADD COLUMN IF NOT EXISTS debtor_message_template text;
      ALTER TABLE collection_ladder_steps DROP CONSTRAINT IF EXISTS ck_ladder_steps_debtor_channel;
      ALTER TABLE collection_ladder_steps ADD CONSTRAINT ck_ladder_steps_debtor_channel
        CHECK (debtor_channel IN ('NONE','EMAIL','SMS','EMAIL_SMS'));
      ALTER TABLE collection_ladder_steps DROP CONSTRAINT IF EXISTS ck_ladder_steps_debtor_message;
      ALTER TABLE collection_ladder_steps ADD CONSTRAINT ck_ladder_steps_debtor_message
        CHECK (debtor_channel = 'NONE' OR length(trim(coalesce(debtor_message_template, ''))) > 0);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE collection_ladder_steps
        DROP CONSTRAINT IF EXISTS ck_ladder_steps_debtor_message,
        DROP CONSTRAINT IF EXISTS ck_ladder_steps_debtor_channel,
        DROP COLUMN IF EXISTS debtor_message_template,
        DROP COLUMN IF EXISTS debtor_subject,
        DROP COLUMN IF EXISTS debtor_channel;
    `);
  }
}
