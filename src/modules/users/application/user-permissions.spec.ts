import { PermissionRepository, UserPermissionRepository } from '@/modules/access-control/domain/access-control.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ForbiddenError, ValidationError } from '@/shared/domain/errors';
import { SetUserPermissionsUseCase } from './user-permissions.use-cases';

const me = (permissions: string[], id = 1): AuthenticatedUser => ({ id, email: 'm@x.ao', roleId: 1, organizationId: 1, isManager: false, permissions });

function setup(roleSlugs: string[], granted: string[] = []) {
  const stored = { value: [...granted] };
  const audits: unknown[] = [];
  const users = { findById: async () => ({ id: 5, roleId: 2, role: { id: 2, isActive: true } }) };
  const perms = { activeSlugsForRole: async () => roleSlugs } as unknown as PermissionRepository;
  const grants = {
    existingActive: async (s: string[]) => s.filter((x) => x !== 'inexistente'),
    grantedSlugs: async () => stored.value,
    replace: async (_u: number, next: string[]) => {
      const added = next.filter((x) => !stored.value.includes(x));
      const removed = stored.value.filter((x) => !next.includes(x));
      stored.value = next;
      return { added, removed };
    },
  } as unknown as UserPermissionRepository;
  const uow = { run: (w: () => Promise<unknown>) => w() } as unknown as UnitOfWork;
  const audit = { record: async (e: unknown) => void audits.push(e) } as unknown as AuditTrail;
  return { uc: new SetUserPermissionsUseCase(users as never, perms, grants, uow, audit), stored, audits };
}

describe('SetUserPermissionsUseCase', () => {
  it('não permite alterar as próprias permissões', async () => {
    await expect(setup([]).uc.execute(me(['a'], 5), 5, ['a'])).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('recusa permissões desconhecidas', async () => {
    await expect(setup([]).uc.execute(me(['inexistente']), 5, ['inexistente'])).rejects.toBeInstanceOf(ValidationError);
  });
  it('só dá o que se tem (sem escalada)', async () => {
    await expect(setup([]).uc.execute(me(['a']), 5, ['b'])).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('não guarda o que o perfil já dá; audita adições e remoções', async () => {
    const { uc, stored, audits } = setup(['a'], ['old']);
    const r = await uc.execute(me(['a', 'b']), 5, ['a', 'b']);
    expect(stored.value).toEqual(['b']);
    expect(r).toEqual({ added: ['b'], removed: ['old'] });
    expect(audits).toHaveLength(1);
  });
});
