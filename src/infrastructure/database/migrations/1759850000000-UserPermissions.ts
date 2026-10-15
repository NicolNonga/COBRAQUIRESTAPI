import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permissões dadas a um utilizador em particular, somadas às do perfil.
 * Só concedem (não retiram): as permissões efectivas são perfil ∪ utilizador.
 */
export class UserPermissions1759850000000 implements MigrationInterface {
  name = 'UserPermissions1759850000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id        int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission_id  int NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        granted_by_id  int REFERENCES users(id) ON DELETE SET NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, permission_id)
      );
      CREATE INDEX IF NOT EXISTS ix_user_permissions_permission ON user_permissions (permission_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS user_permissions');
  }
}
