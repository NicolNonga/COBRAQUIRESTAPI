import { PERMISSION_CATALOG, SUPER_ADMIN_ROLE } from '../domain/permission-catalog';

type Query = (sql: string, params?: unknown[]) => Promise<any>;

/**
 * Sincroniza o catálogo de permissões com a BD (idempotente, seguro em várias instâncias):
 *  1. insere/actualiza cada permissão; as novas são atribuídas aos perfis por omissão;
 *  2. desactiva permissões que já não existem no catálogo;
 *  3. garante que o super-admin tem todas as permissões activas.
 */
export async function syncPermissionCatalog(query: Query): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const d of PERMISSION_CATALOG) {
    const rows: Array<{ id: number; inserted: boolean }> = await query(
      `INSERT INTO permissions (slug, name, description, is_active) VALUES ($1, $2, $3, true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true, updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [d.slug, d.name, d.description],
    );
    const { id, inserted } = rows[0];
    if (inserted) {
      created.push(d.slug);
      if (d.defaultRoles?.length) {
        await query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT r.id, $1 FROM roles r WHERE r.slug = ANY($2) ON CONFLICT DO NOTHING`,
          [id, d.defaultRoles],
        );
      }
    }
  }
  await query(`UPDATE permissions SET is_active = false, updated_at = now() WHERE is_active AND NOT (slug = ANY($1))`, [
    PERMISSION_CATALOG.map((d) => d.slug),
  ]);
  await query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.slug = $1 AND p.is_active
     ON CONFLICT DO NOTHING`,
    [SUPER_ADMIN_ROLE],
  );
  return { created };
}
