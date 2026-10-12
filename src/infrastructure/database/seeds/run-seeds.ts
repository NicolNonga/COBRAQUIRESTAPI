import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import dataSource from '../data-source';
import { syncPermissionCatalog } from '@/modules/access-control/infrastructure/permission-catalog.sync';

/**
 * Seeds: dados de referência + catálogo de permissões + super-admin inicial.
 * O super-admin recebe automaticamente todas as permissões do catálogo.
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed
 */
async function run(): Promise<void> {
  const ds = await dataSource.initialize();
  try {
    await ds.transaction(async (m) => {
      await m.query(readFileSync(join(__dirname, 'reference-data.sql'), 'utf8'));
      const { created } = await syncPermissionCatalog((sql, p) => m.query(sql, p));
      console.log(`Permissões: ${created.length} nova(s), super-admin com acesso total.`);
      const email = process.env.ADMIN_EMAIL;
      const password = process.env.ADMIN_PASSWORD;
      if (email && password) {
        if (password.length < 12) throw new Error('ADMIN_PASSWORD deve ter pelo menos 12 caracteres');
        await m.query(
          `INSERT INTO users (full_name, email, password_hash, role_id, first_access)
           SELECT 'Administrador', $1, $2, id, true FROM roles WHERE slug = 'super-admin'
           ON CONFLICT ((lower(email))) DO NOTHING`,
          [email.toLowerCase(), await bcrypt.hash(password, 12)],
        );
      }
    });
    console.log('Seeds aplicados.');
  } finally {
    await ds.destroy();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
