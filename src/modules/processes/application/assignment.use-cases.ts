import { Injectable, Logger } from '@nestjs/common';
import { SUPER_ADMIN_SLUG } from '@/modules/access-control/domain/access-control.repository';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { Assignment, ProcessCommandRepository } from '../domain/process.repository';

/** Agrupa por agente → 1 notificação por agente (não 1 por processo). */
const notificationsFor = (assignments: Assignment[]) => {
  const byUser = new Map<number, number[]>();
  assignments.forEach((a) => byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a.processId]));
  return [...byUser].map(([userId, processIds]) => ({
    userId,
    type: 'process.assigned',
    title: 'Novos processos atribuídos',
    message: processIds.length === 1 ? 'Tem um novo processo atribuído' : `Tem ${processIds.length} novos processos atribuídos`,
    data: { processIds },
    priority: 'medium' as const,
  }));
};

@Injectable()
export class AssignWalletProcessesUseCase {
  private readonly logger = new Logger(AssignWalletProcessesUseCase.name);
  constructor(
    private readonly processes: ProcessCommandRepository,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(): Promise<number> {
    return this.uow.run(async () => {
      const created = await this.processes.assignFromWallets();
      if (created.length) {
        await this.notifications.publish(notificationsFor(created));
        await this.audit.record({ action: 'PROCESSES_ASSIGNED_FROM_WALLETS', entity: 'process', payload: { count: created.length } });
        this.logger.log({ count: created.length }, 'Processos atribuídos pelas carteiras');
      }
      return created.length;
    });
  }
}

@Injectable()
export class AutoAssignProcessesUseCase {
  constructor(
    private readonly processes: ProcessCommandRepository,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(): Promise<number> {
    return this.uow.run(async () => {
      const created = await this.processes.autoAssignRoundRobin(SUPER_ADMIN_SLUG);
      if (!created.length) throw new BusinessRuleError('Nenhum processo por atribuir ou nenhum agente disponível');
      await this.notifications.publish(notificationsFor(created));
      await this.audit.record({ action: 'PROCESSES_AUTO_ASSIGNED', entity: 'process', payload: { count: created.length } });
      return created.length;
    });
  }
}

@Injectable()
export class AssignProcessToUserUseCase {
  constructor(
    private readonly processes: ProcessCommandRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(processId: number, userId: number): Promise<void> {
    return this.uow.run(async () => {
      if (!(await this.processes.findOpen(processId))) throw new NotFoundError('Processo não encontrado ou fechado');
      const user = await this.users.findAuthSnapshot(userId);
      if (!user?.isActive) throw new NotFoundError('Utilizador não encontrado ou inactivo');
      if (!(await this.processes.assign(processId, userId))) {
        const owner = await this.processes.currentAssignee(processId);
        throw new ConflictError(owner === userId ? 'Processo já adicionado ao utilizador' : 'Processo já atribuído a outro agente; use a transferência');
      }
      await this.notifications.publish(notificationsFor([{ processId, userId }]));
      await this.audit.record({ action: 'PROCESS_ASSIGNED', entity: 'process', entityId: processId, payload: { userId } });
    });
  }
}
