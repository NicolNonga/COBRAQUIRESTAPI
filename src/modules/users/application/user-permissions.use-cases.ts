import { Injectable } from '@nestjs/common';
import { PermissionRepository, UserPermissionRepository } from '@/modules/access-control/domain/access-control.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ForbiddenError, NotFoundError, ValidationError } from '@/shared/domain/errors';
import { UserRepository } from '../domain/user.repository';

/** Permissões de um utilizador: as que vêm do perfil e as que lhe foram dadas a ele. */
@Injectable()
export class GetUserPermissionsUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly perms: PermissionRepository,
    private readonly grants: UserPermissionRepository,
  ) {}

  async execute(userId: number) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Utilizador não encontrado');
    const fromRole = user.roleId && user.role?.isActive ? await this.perms.activeSlugsForRole(user.roleId) : [];
    return { userId, role: user.role ? { id: user.role.id, name: user.role.name, isActive: user.role.isActive } : null, fromRole: fromRole.sort(), granted: await this.grants.grantedSlugs(userId) };
  }
}

/**
 * Dar (ou retirar) permissões a um utilizador em particular, somando ao perfil.
 * Regras contra escalada de privilégios:
 *  - não se altera as próprias permissões (outra pessoa tem de o fazer);
 *  - só se dá o que se tem (o super-admin tem tudo);
 *  - o que o perfil já dá não se guarda de novo.
 * As permissões são lidas a cada pedido, por isso a alteração vale logo.
 */
@Injectable()
export class SetUserPermissionsUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly perms: PermissionRepository,
    private readonly grants: UserPermissionRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(me: AuthenticatedUser, userId: number, requested: string[]) {
    return this.uow.run(async () => {
      if (me.id === userId) throw new ForbiddenError('Não pode alterar as suas próprias permissões; peça a outra pessoa.');
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('Utilizador não encontrado');

      const wanted = [...new Set(requested.map((s) => s.trim()))];
      const valid = new Set(await this.grants.existingActive(wanted));
      const unknown = wanted.filter((s) => !valid.has(s));
      if (unknown.length) throw new ValidationError('Permissão desconhecida', { unknown });

      const fromRole = new Set(user.roleId && user.role?.isActive ? await this.perms.activeSlugsForRole(user.roleId) : []);
      const extras = wanted.filter((s) => !fromRole.has(s));

      const current = new Set(await this.grants.grantedSlugs(userId));
      const adding = extras.filter((s) => !current.has(s));
      const notMine = adding.filter((s) => !me.permissions.includes(s));
      if (notMine.length) throw new ForbiddenError('Só pode dar permissões que você próprio tem.', { permissions: notMine });

      const { added, removed } = await this.grants.replace(userId, extras, me.id);
      if (added.length || removed.length) {
        await this.audit.record({ action: 'USER_PERMISSIONS_CHANGED', entity: 'user', entityId: userId, payload: { added, removed } });
      }
      return { added, removed };
    });
  }
}
