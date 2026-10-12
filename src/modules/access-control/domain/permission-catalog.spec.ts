import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '@/modules/auth/presentation/permissions.guard';
import { PERMISSIONS_KEY } from '@/modules/auth/presentation/require-permissions.decorator';
import { ForbiddenError } from '@/shared/domain/errors';
import { catalogEntry, P, PERMISSION_CATALOG } from './permission-catalog';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

describe('Catálogo de permissões', () => {
  it('não tem slugs duplicados e cobre todas as constantes P', () => {
    const slugs = PERMISSION_CATALOG.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of Object.values(P)) expect(catalogEntry(s)).toBeDefined();
  });

  it('todas as permissões têm nome, descrição e área', () => {
    for (const d of PERMISSION_CATALOG) {
      expect(d.name.trim()).not.toBe('');
      expect(d.description.trim().length).toBeGreaterThan(10);
      expect(d.group.trim()).not.toBe('');
    }
  });

  it('todos os slugs usados em código existem no catálogo', () => {
    const src = join(__dirname, '../../..');
    const used = new Set<string>();
    for (const f of walk(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.includes('migrations'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/'([a-z_]+_permission)'/g)) used.add(m[1]);
    }
    const unknown = [...used].filter((s) => s !== 'roles_permission' && !catalogEntry(s));
    expect(unknown).toEqual([]);
  });
});

describe('PermissionsGuard', () => {
  const ctx = (permissions: string[], required?: string[]) => {
    const handler = () => undefined;
    if (required) Reflect.defineMetadata(PERMISSIONS_KEY, required, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
    } as never;
  };
  const guard = new PermissionsGuard(new Reflector());

  it('deixa passar rotas sem permissão exigida', () => expect(guard.canActivate(ctx([]))).toBe(true));
  it('deixa passar quem tem a permissão', () => expect(guard.canActivate(ctx([P.DEBTOR_VIEW], [P.DEBTOR_VIEW]))).toBe(true));
  it('bloqueia com mensagem legível', () => {
    expect(() => guard.canActivate(ctx([P.DEBTOR_VIEW], [P.DEBTOR_CREATE]))).toThrow(ForbiddenError);
    expect(() => guard.canActivate(ctx([], [P.DEBTOR_CREATE]))).toThrow(/Criar devedores/);
  });
});
