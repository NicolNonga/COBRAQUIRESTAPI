import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Estado inicial "Registado": o processo só passa a "Em cobrança" quando a cobrança arranca. */
export class ProcessRegisteredState1759820000000 implements MigrationInterface {
  name = 'ProcessRegisteredState1759820000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(readFileSync(join(__dirname, 'process-registered-state.sql'), 'utf8'));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE processes SET process_state_id = (SELECT id FROM process_states WHERE code = 'IN_PROGRESS')
       WHERE process_state_id = (SELECT id FROM process_states WHERE code = 'REGISTERED');
      UPDATE process_states SET name = 'Em curso' WHERE code = 'IN_PROGRESS';
      DELETE FROM process_states WHERE code = 'REGISTERED';
    `);
  }
}
