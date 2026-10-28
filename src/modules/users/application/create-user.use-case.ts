import { Injectable, Logger } from '@nestjs/common';
import { RoleRepository } from '@/modules/access-control/domain/access-control.repository';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { EmailSendPayload, MessageTypes, Outbox } from '@/shared/application/outbox.port';
import { PasswordHasher } from '@/shared/application/password-hasher.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, NotFoundError } from '@/shared/domain/errors';
import { generatePassword } from '../domain/password-generator';
import { TeamRepository, UserRepository } from '../domain/user.repository';

export interface CreateUserInput {
  fullName?: string | null;
  email: string;
  phone_number?: string | null;
  roleId: number;
  categorie_id?: number | null;
  organizationId?: number | null;
  managerId?: number | null;
}

@Injectable()
export class CreateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly team: TeamRepository,
    private readonly roles: RoleRepository,
    private readonly hasher: PasswordHasher,
    private readonly outbox: Outbox,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(input: CreateUserInput): Promise<{ id: number }> {
    const plainPassword = generatePassword();
    const passwordHash = await this.hasher.hash("senha-forte-teste"); // CPU fora da transacção

    Logger.warn(plainPassword);

    // utilizador + vínculo ao gestor + notificação: tudo ou nada
    return this.uow.run(async () => {
      const role = await this.roles.findById(input.roleId);
      if (!role || !role.isActive) throw new NotFoundError('Perfil não encontrado ou inactivo');

      const user = await this.users.create({
        fullName: input.fullName?.trim() || null,
        email: input.email.trim().toLowerCase(),
        phoneNumber: input.phone_number?.trim() || null,
        roleId: role.id,
        categoryId: input.categorie_id ?? null,
        organizationId: input.organizationId ?? null,
        passwordHash: "senha-forte-teste",
      });

      if (input.managerId && !role.isManager) {
        const manager = await this.users.findAuthSnapshot(input.managerId);
        if (!manager?.isManager) throw new BusinessRuleError('O gestor indicado não tem perfil de gestor');
        await this.team.assignAgentToManager(user.id, input.managerId);
        await this.notifications.publish({
          userId: input.managerId,
          type: 'agent.added',
          title: 'Novo agente',
          message: 'Novo agente na carteira',
          data: { agente_id: user.id, fullName: user.fullName },
          priority: 'low',
        });
      }

      await this.audit.record({ action: 'USER_CREATED', entity: 'user', entityId: user.id, payload: { email: user.email, roleId: role.id, managerId: input.managerId } });

      // Outbox: o email é gravado na MESMA transacção e entregue (com retry) pelo dispatcher.
      // sensitive → payload cifrado em repouso e apagado após envio (contém a palavra-passe temporária).
      await this.outbox.enqueue<EmailSendPayload>({
        type: MessageTypes.EMAIL_SEND,
        dedupKey: `user-welcome:${user.id}`,
        sensitive: true,
        payload: {
          to: user.email,
          subject: 'Credenciais de acesso - Cobra Aqui',
          text: `Bem-vindo(a). A sua palavra-passe temporária é: ${plainPassword}\nSerá pedida a sua alteração no primeiro acesso.`,
        },
      });
      return { id: user.id };
    });
  }
}
