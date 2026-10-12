import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class OutboxInbox1759690000000 implements MigrationInterface {
  name = 'OutboxInbox1759690000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'outbox-inbox.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TRIGGER IF EXISTS trg_outbox_notify ON outbox_messages;
      DROP FUNCTION IF EXISTS outbox_notify();
      DROP TABLE IF EXISTS inbox_messages, outbox_messages;
      DELETE FROM permissions WHERE slug = 'outbox_manage_permission';
    `);
  }
}
