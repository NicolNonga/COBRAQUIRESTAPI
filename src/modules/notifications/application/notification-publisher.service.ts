import { Injectable } from '@nestjs/common';
import { MessageTypes, NotificationRequestedPayload, Outbox } from '@/shared/application/outbox.port';
import { NotificationPublisher } from '../domain/notification-publisher.port';
import { NewNotification } from '../domain/notification.repository';

export const NOTIFICATION_CREATED_EVENT = 'notification-created';

/**
 * Publicação de notificações 100% via Outbox.
 *
 * O caso de uso NÃO escreve em `notifications` nem fala com o socket: apenas grava um
 * evento `notification.requested` na outbox, na MESMA transacção da operação de negócio.
 * Fluxo assíncrono, cada passo com retry e idempotência (inbox):
 *
 *   caso de uso ──tx──► outbox: notification.requested
 *                         └─► PersistNotificationsHandler (transaccional, exactly-once)
 *                               ├─ INSERT notifications
 *                               └─ outbox: notification.created
 *                                    └─► RealtimeNotificationHandler → Socket.IO
 *
 * Vantagens: o módulo de negócio fica desacoplado da tabela de notificações; uma falha
 * nas notificações nunca faz rollback de uma transferência/criação de utilizador.
 */
@Injectable()
export class NotificationPublisherService extends NotificationPublisher {
  constructor(private readonly outbox: Outbox) {
    super();
  }

  async publish(items: NewNotification | NewNotification[]): Promise<void> {
    const list = Array.isArray(items) ? items : [items];
    if (!list.length) return;
    // 1 mensagem para N notificações (ex.: atribuição em lote) — sem N inserts na outbox
    await this.outbox.enqueue<NotificationRequestedPayload>({
      type: MessageTypes.NOTIFICATION_REQUESTED,
      payload: { items: list },
      maxAttempts: 10,
    });
  }
}
