import { MigrationInterface, QueryRunner } from 'typeorm';

/** Permissão para consultar o trilho de auditoria (GET /api/audit-logs). Atribuída ao super-admin. */
export class AuditView1759760000000 implements MigrationInterface {
  name = 'AuditView1759760000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO permissions (slug, name, description) VALUES
        ('audit_view_permission', 'Ver auditoria', 'Consultar o trilho de auditoria (quem fez o quê, quando e de onde)')
      ON CONFLICT (slug) DO NOTHING;
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
       WHERE r.slug = 'super-admin' AND p.slug = 'audit_view_permission'
      ON CONFLICT DO NOTHING;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE slug = 'audit_view_permission');
      DELETE FROM permissions WHERE slug = 'audit_view_permission';
    `);
  }
}
