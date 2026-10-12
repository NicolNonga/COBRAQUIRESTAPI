import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { auditDiff, prefixed } from '@/shared/application/audit-diff';
import { PageRequest } from '@/shared/domain/pagination';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { ADMIN_ROLE_NAME, isProtectedRole, PROTECTED_ROLE_MESSAGE, RoleRepository, SUPER_ADMIN_SLUG } from '../domain/access-control.repository';
import { slugify } from '../domain/slug';

@Injectable()
export class CreateRoleUseCase {
  constructor(private readonly roles: RoleRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(input: { name: string; description?: string; isManager?: boolean }) {
    return this.uow.run(async () => {
      if (await this.roles.existsByName(input.name)) throw new ConflictError('Nome do Perfil já existe');
      const role = await this.roles.create({
        name: input.name.trim(),
        slug: `${slugify(input.name)}_role`,
        description: input.description ?? null,
        isManager: input.isManager ?? false,
      });
      await this.audit.record({ action: 'ROLE_CREATED', entity: 'role', entityId: role.id, payload: input });
      return role;
    });
  }
}

@Injectable()
export class UpdateRoleUseCase {
  constructor(private readonly roles: RoleRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(id: number, input: { name: string; description?: string; isManager?: boolean }) {
    return this.uow.run(async () => {
      const role = await this.roles.findById(id);
      if (!role) throw new NotFoundError('Perfil não encontrado');
      if (isProtectedRole(role)) throw new BusinessRuleError(PROTECTED_ROLE_MESSAGE);
      if (await this.roles.existsByName(input.name, id)) throw new ConflictError('Nome do Perfil já existe');
      const before = await this.audit.snapshot('roles', { id });
      const ok = await this.roles.update(id, {
        name: input.name.trim(),
        description: input.description ?? null,
        ...(input.isManager !== undefined ? { isManager: input.isManager } : {}),
      });
      if (!ok) throw new NotFoundError('Perfil não encontrado');
      await this.audit.record({ action: 'ROLE_UPDATED', entity: 'role', entityId: id, payload: { ...auditDiff(before, await this.audit.snapshot('roles', { id })) } });
    });
  }
}

@Injectable()
export class SetRoleActiveUseCase {
  constructor(private readonly roles: RoleRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(id: number, active: boolean) {
    return this.uow.run(async () => {
      const role = await this.roles.findById(id);
      if (!role) throw new NotFoundError('Perfil não encontrado');
      if (isProtectedRole(role)) throw new BusinessRuleError(PROTECTED_ROLE_MESSAGE);
      if (!active && (role.slug === SUPER_ADMIN_SLUG || role.name.toLowerCase() === ADMIN_ROLE_NAME)) {
        throw new BusinessRuleError('Não pode desactivar o perfil de administrador');
      }
      await this.roles.update(id, { isActive: active });
      await this.audit.record({ action: active ? 'ROLE_ENABLED' : 'ROLE_DISABLED', entity: 'role', entityId: id, payload: { before: { isActive: role.isActive }, after: { isActive: active } } });
    });
  }
}

@Injectable()
export class ListRolesUseCase {
  constructor(private readonly roles: RoleRepository) {}
  paginate(req: PageRequest) {
    return this.roles.paginateWithActivePermissions(req);
  }
  dropdown() {
    return this.roles.listActive({ excludeSlug: SUPER_ADMIN_SLUG });
  }
  managers() {
    return this.roles.listActive({ onlyManagers: true });
  }
}
