import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import dataSource from '../data-source';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { syncPermissionCatalog } from '@/modules/access-control/infrastructure/permission-catalog.sync';

/**
 * Cria (ou repõe a palavra-passe de) um utilizador directamente na BD — útil em testes,
 * p.ex. um segundo utilizador para confirmar pagamentos (regra dos quatro olhos).
 *
 *   npm run user:create -- --email financeiro@teste.ao --name "Financeiro Teste"
 *   npm run user:create -- --email x@y.ao --role gestor_role --password 'palavra-passe-com-12+'
 *   npm run user:create -- --email x@y.ao --reset          (gera nova palavra-passe)
 *
 * Perfil por omissão: "Financeiro" (financeiro_role), criado se não existir, com permissões
 * para ver e confirmar pagamentos, ver acordos/devedores/facturas e liquidar credores.
 * Sem --password é gerada uma palavra-passe aleatória, mostrada só neste terminal.
 */
const FINANCE_PERMS = [
  P.DASHBOARD_VIEW, P.DEBTOR_VIEW, P.INVOICE_VIEW, P.NEGOTIATION_VIEW, P.PAYMENT_VIEW, P.PAYMENT_CONFIRM,
  P.CREDITOR_ACCOUNT_VIEW, P.CREDITOR_SETTLEMENT, P.PROCESS_VIEW,
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function run(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Indique o email: npm run user:create -- --email nome@empresa.ao');
  const name = arg('name') ?? 'Utilizador de teste';
  const roleSlug = arg('role') ?? 'financeiro_role';
  const reset = process.argv.includes('--reset');
  const password = arg('password') ?? randomBytes(9).toString('base64url'); // 12 caracteres
  if (password.length < 12) throw new Error('A palavra-passe deve ter pelo menos 12 caracteres');

  const ds = await dataSource.initialize();
  try {
    await ds.transaction(async (m) => {
      await syncPermissionCatalog((sql, p) => m.query(sql, p));
      if (roleSlug === 'financeiro_role') {
        const created: Array<{ id: number }> = await m.query(
          `INSERT INTO roles (slug, name, description, is_manager) VALUES ('financeiro_role', 'Financeiro', 'Confirma pagamentos e liquida credores', false)
           ON CONFLICT (slug) DO NOTHING RETURNING id`,
        );
        if (created.length) {
          await m.query(
            `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE slug = ANY($2) ON CONFLICT DO NOTHING`,
            [created[0].id, FINANCE_PERMS],
          );
          console.log('Perfil "Financeiro" criado com permissões de pagamentos.');
        }
      }
      const [role] = await m.query('SELECT id, name FROM roles WHERE slug = $1', [roleSlug]);
      if (!role) throw new Error(`Perfil "${roleSlug}" não existe`);

      const hash = await bcrypt.hash(password, 12);
      const [existing] = await m.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
      if (existing && !reset) throw new Error(`Já existe um utilizador com ${email}. Use --reset para gerar nova palavra-passe.`);
      if (existing) {
        await m.query('UPDATE users SET password_hash = $2, is_active = true, first_access = false, token_version = token_version + 1, updated_at = now() WHERE id = $1', [existing.id, hash]);
      } else {
        await m.query(
          `INSERT INTO users (full_name, email, password_hash, role_id, first_access) VALUES ($1, $2, $3, $4, false)`,
          [name, email, hash, role.id],
        );
      }
      console.log(`\nUtilizador ${existing ? 'actualizado' : 'criado'}:`);
      console.log(`  Email:  ${email}`);
      console.log(`  Palavra-passe:  ${password}`);
      console.log(`  Perfil: ${role.name}\n`);
    });
  } finally {
    await ds.destroy();
  }
}

run().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
