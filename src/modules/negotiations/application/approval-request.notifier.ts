import { Injectable } from '@nestjs/common';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { UserRepository } from '@/modules/users/domain/user.repository';

/** Pede aprovação ao gestor de quem criou a negociação (notificação via outbox). */
@Injectable()
export class ApprovalRequestNotifier {
  constructor(private readonly users: UserRepository, private readonly notifications: NotificationPublisher) {}

  async notify(negotiationId: number, createdById: number, discountRate: string, renegotiationOf?: number): Promise<void> {
    const managerId = await this.users.managerOf(createdById);
    if (!managerId) return; // sem gestor: fica na fila GET /negotiations?status=PENDING_APPROVAL para quem tem a permissão
    await this.notifications.publish({
      userId: managerId,
      type: 'negotiation.approval_requested',
      title: renegotiationOf ? 'Renegociação para aprovar' : 'Negociação para aprovar',
      message: `Desconto de ${discountRate}% acima do limite. Negociação #${negotiationId}${renegotiationOf ? ` (renegocia #${renegotiationOf})` : ''} aguarda aprovação.`,
      data: { negotiationId, createdById, discountRate, renegotiationOf },
      priority: 'high',
      actionUrl: `/negotiations/${negotiationId}`,
    });
  }
}
