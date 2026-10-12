import { Injectable, Logger } from '@nestjs/common';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, NotFoundError } from '@/shared/domain/errors';
import { ProcessCommandRepository } from '../domain/process.repository';

export interface TransferProcessesInput {
  processIds: number[];
  fromUserId: number;
  toUserId: number;
  reason: string;
  notes?: string;
  isPermanent: boolean;
  returnAt?: Date;
  performedById: number;
}

@Injectable()
export class TransferProcessesUseCase {
  constructor(
    private readonly processes: ProcessCommandRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationPublisher,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(input: TransferProcessesInput): Promise<number> {
    const ids = [...new Set(input.processIds)];
    if (input.fromUserId === input.toUserId) throw new BusinessRuleError('O agente de destino deve ser diferente do de origem');
    if (!input.isPermanent) {
      if (!input.returnAt || input.returnAt <= this.clock.now()) {
        throw new BusinessRuleError('Transferência temporária exige data de retorno futura');
      }
    }

    return this.uow.run(async () => {
      const target = await this.users.findAuthSnapshot(input.toUserId);
      if (!target?.isActive) throw new NotFoundError('Agente de destino não encontrado ou inactivo');

      // FOR UPDATE: duas transferências simultâneas do mesmo processo serializam aqui;
      // a segunda já não encontra o processo com o agente de origem → erro claro, sem estado corrompido.
      const owned = await this.processes.lockAssignments(ids, input.fromUserId);
      const missing = ids.filter((id) => !owned.includes(id));
      if (missing.length) {
        throw new BusinessRuleError('Alguns processos não pertencem ao agente de origem', { processIds: missing });
      }

      await this.processes.insertTransfers(
        ids.map((processId) => ({
          processId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          performedById: input.performedById,
          reason: input.reason.trim(),
          notes: input.notes?.trim() || null,
          // o original gravava este valor INVERTIDO (definitiva → false)
          isPermanent: input.isPermanent,
          returnAt: input.isPermanent ? null : input.returnAt!,
        })),
      );
      const moved = await this.processes.reassign(ids, input.fromUserId, input.toUserId);

      await this.notifications.publish([
        { userId: input.toUserId, type: 'process.transferred_in', title: 'Processos recebidos', message: `Recebeu ${moved} processo(s) por transferência`, data: { processIds: ids }, priority: 'medium' },
        { userId: input.fromUserId, type: 'process.transferred_out', title: 'Processos transferidos', message: `${moved} processo(s) foram transferidos`, data: { processIds: ids }, priority: 'low' },
      ]);
      await this.audit.record({
        action: 'PROCESSES_TRANSFERRED',
        entity: 'process',
        payload: { processIds: ids, from: input.fromUserId, to: input.toUserId, isPermanent: input.isPermanent, returnAt: input.returnAt },
      });
      return moved;
    });
  }
}

@Injectable()
export class ReturnTemporaryTransfersUseCase {
  private readonly logger = new Logger(ReturnTemporaryTransfersUseCase.name);
  constructor(
    private readonly processes: ProcessCommandRepository,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(): Promise<number> {
    return this.uow.run(async () => {
      const returned = await this.processes.returnDueTemporaryTransfers();
      if (returned.length) {
        const byUser = new Map<number, number[]>();
        returned.forEach((r) => byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.processId]));
        await this.notifications.publish(
          [...byUser].map(([userId, processIds]) => ({
            userId,
            type: 'process.transfer_returned',
            title: 'Processos devolvidos',
            message: `${processIds.length} processo(s) regressaram à sua carteira`,
            data: { processIds },
          })),
        );
        await this.audit.record({ action: 'TEMPORARY_TRANSFERS_RETURNED', entity: 'process', payload: { count: returned.length } });
        this.logger.log({ count: returned.length }, 'Transferências temporárias devolvidas');
      }
      return returned.length;
    });
  }
}
