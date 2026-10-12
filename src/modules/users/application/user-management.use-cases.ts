import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { auditDiff, prefixed } from '@/shared/application/audit-diff';
import { EmailSendPayload, MessageTypes, Outbox } from '@/shared/application/outbox.port';
import { PasswordHasher } from '@/shared/application/password-hasher.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { NotFoundError, UnauthorizedError } from '@/shared/domain/errors';
import { Criteria, Sort } from '@/shared/domain/criteria';
import { PageRequest } from '@/shared/domain/pagination';
import { generatePassword } from '../domain/password-generator';
import { TeamRepository, UserField, UserQueries, UserRepository } from '../domain/user.repository';

@Injectable()
export class UpdateUserUseCase {
  constructor(private readonly users: UserRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(id: number, input: { fullName?: string | null; email: string; phone_number?: string | null; roleId: number; categorie_id?: number | null }) {
    return this.uow.run(async () => {
      const before = await this.audit.snapshot('users', { id });
      const ok = await this.users.update(id, {
        fullName: input.fullName?.trim() || null,
        email: input.email.trim().toLowerCase(),
        phoneNumber: input.phone_number?.trim() || null,
        roleId: input.roleId,
        categoryId: input.categorie_id ?? null,
      });
      if (!ok) throw new NotFoundError('Utilizador não encontrado');
      await this.users.bumpTokenVersion(id); // perfil pode ter mudado → forçar novo login
      await this.audit.record({ action: 'USER_UPDATED', entity: 'user', entityId: id, payload: { ...auditDiff(before, await this.audit.snapshot('users', { id })) } });
    });
  }
}

@Injectable()
export class SetUserActiveUseCase {
  constructor(private readonly users: UserRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(id: number, active: boolean) {
    return this.uow.run(async () => {
      if (!(await this.users.update(id, { isActive: active }))) throw new NotFoundError('Utilizador não encontrado');
      if (!active) await this.users.bumpTokenVersion(id); // desactivado = sessões terminam já
      await this.audit.record({ action: active ? 'USER_ENABLED' : 'USER_DISABLED', entity: 'user', entityId: id, payload: { before: { isActive: !active }, after: { isActive: active } } });
    });
  }
}

@Injectable()
export class AdminResetPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly outbox: Outbox,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(id: number): Promise<void> {
    const plain = generatePassword();
    const hash = await this.hasher.hash(plain);
    await this.uow.run(async () => {
      const user = await this.users.findCredentialsById(id);
      if (!user) throw new NotFoundError('Utilizador não encontrado');
      await this.users.setPassword(id, hash, { firstAccess: true });
      await this.audit.record({ action: 'USER_PASSWORD_RESET_BY_ADMIN', entity: 'user', entityId: id });
      await this.outbox.enqueue<EmailSendPayload>({
        type: MessageTypes.EMAIL_SEND,
        sensitive: true,
        payload: { to: user.email, subject: 'Palavra-passe redefinida', text: `A sua palavra-passe foi redefinida para: ${plain}` },
      });
    });
  }
}

/**
 * Troca da PRÓPRIA palavra-passe exigindo a palavra-passe actual.
 * O original recebia `email` no body e alterava a palavra-passe de QUALQUER utilizador
 * (escalada de privilégios). Aqui o alvo é sempre o utilizador autenticado.
 */
@Injectable()
export class ChangeOwnPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const creds = await this.users.findCredentialsById(userId);
    if (!creds || !(await this.hasher.verify(creds.passwordHash, currentPassword))) {
      throw new UnauthorizedError('Palavra-passe actual incorrecta');
    }
    const hash = await this.hasher.hash(newPassword);
    await this.uow.run(async () => {
      await this.users.setPassword(userId, hash, { firstAccess: false });
      await this.audit.record({ action: 'USER_PASSWORD_CHANGED', entity: 'user', entityId: userId });
    });
  }
}

@Injectable()
export class UserQueriesUseCase {
  constructor(private readonly q: UserQueries, private readonly team: TeamRepository) {}
  list(f: { page: number; perPage: number; search?: string; sort?: Sort<UserField>[]; roleId?: number; organizationId?: number; categoryId?: number; isActive?: boolean }) {
    return this.q.search(
      Criteria.for<UserField>()
        .add('roleId', f.roleId)
        .add('organizationId', f.organizationId)
        .add('categoryId', f.categoryId)
        .add('isActive', f.isActive)
        .anyOf(['fullName', 'email'], f.search)
        .orderBy(f.sort, { field: 'createdAt', direction: 'DESC' })
        .paginate(f.page, f.perPage)
        .build(),
    );
  }
  dropdown() {
    return this.q.activeDropdown();
  }
  managers() {
    return this.q.activeManagers();
  }
  async inOrganization(userId: number, organizationId: number) {
    return this.q.findInOrganization(userId, organizationId);
  }
  agentsOf(managerId: number, req: PageRequest) {
    return this.team.paginateAgents(managerId, req);
  }
  allAgentsOf(managerId: number) {
    return this.team.listAgents(managerId);
  }
}
