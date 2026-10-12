import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { PageRequest } from '@/shared/domain/pagination';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { isProtectedRole, Permission, PermissionRepository, PROTECTED_ROLE_MESSAGE, RolePermissionRepository, RoleRepository } from '../domain/access-control.repository';
import { catalogEntry, GROUP_ORDER } from '../domain/permission-catalog';

/**
 * As permissões vêm do catálogo do código (domain/permission-catalog.ts) e não
 * podem ser criadas nem desactivadas pela API — apenas consultadas e associadas a perfis.
 */
export type PermissionView = Permission & { group: string; order: number };

const enrich = (p: Permission): PermissionView => {
  const c = catalogEntry(p.slug);
  return {
    ...p,
    name: c?.name ?? p.name,
    description: c?.description ?? p.description,
    group: c?.group ?? 'Outras',
    order: c ? GROUP_ORDER.indexOf(c.group) : GROUP_ORDER.length,
  };
};
const byGroup = (a: PermissionView, b: PermissionView) => a.order - b.order || a.name.localeCompare(b.name, 'pt');

@Injectable()
export class ListPermissionsUseCase {
  constructor(private readonly perms: PermissionRepository) {}

  async paginate(req: PageRequest) {
    const page = await this.perms.paginate(req);
    return { ...page, data: page.data.map(enrich) };
  }

  /** Todas as permissões activas, ordenadas por área e nome. */
  async dropdown() {
    return (await this.perms.listActive()).map(enrich).sort(byGroup);
  }

  /** Mesmo conteúdo, já agrupado por área funcional — para o ecrã de permissões. */
  async grouped() {
    const all = await this.dropdown();
    const groups = new Map<string, PermissionView[]>();
    for (const p of all) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
    return [...groups].map(([group, permissions]) => ({ group, permissions }));
  }
}

@Injectable()
export class AttachPermissionToRoleUseCase {
  constructor(
    private readonly rp: RolePermissionRepository,
    private readonly roles: RoleRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(roleId: number, permissionId: number) {
    return this.uow.run(async () => {
      const role = await this.roles.findById(roleId);
      if (!role) throw new NotFoundError('Perfil não encontrado');
      if (isProtectedRole(role)) throw new BusinessRuleError(PROTECTED_ROLE_MESSAGE);
      // FK garante existência de role/permission (23503 → 422 no filtro global)
      if (!(await this.rp.attach(roleId, permissionId))) throw new ConflictError('Este perfil já tem esta permissão');
      await this.audit.record({ action: 'ROLE_PERMISSION_ATTACHED', entity: 'role', entityId: roleId, payload: { permissionId } });
    });
  }
}

@Injectable()
export class DetachPermissionFromRoleUseCase {
  constructor(
    private readonly rp: RolePermissionRepository,
    private readonly roles: RoleRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(roleId: number, permissionId: number) {
    return this.uow.run(async () => {
      const role = await this.roles.findById(roleId);
      if (!role) throw new NotFoundError('Perfil não encontrado');
      if (isProtectedRole(role)) throw new BusinessRuleError(PROTECTED_ROLE_MESSAGE);
      if (!(await this.rp.detach(roleId, permissionId))) throw new NotFoundError('Este perfil não tem esta permissão');
      await this.audit.record({ action: 'ROLE_PERMISSION_DETACHED', entity: 'role', entityId: roleId, payload: { permissionId } });
    });
  }
}
