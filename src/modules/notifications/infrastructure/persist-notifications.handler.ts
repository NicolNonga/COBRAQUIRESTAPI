import { Injectable } from '@nestjs/common';
import { MessageHandler, OutboxEnvelope, OutboxHandler } from '@/shared/application/message-handler';
import { MessageTypes, NotificationCreatedPayload, NotificationRequestedPayload, Outbox } from '@/shared/application/outbox.port';
import { NotificationRepository } from '../domain/notification.repository';

/**
 * Consome `notification.requested`: grava as notificações e encadeia o push em tempo real.
 *
 * `transactional: true` → o dispatcher executa este handler dentro de uma transacção que
 * também grava o registo na inbox (message_id, handler). Ou ficam gravados TODOS
 * (inbox + notificações + evento notification.created), ou nenhum → exactly-once:
 * um retry nunca duplica notificações.
 */
@Injectable()
@OutboxHandler({ name: 'notifications.persist', types: [MessageTypes.NOTIFICATION_REQUESTED], transactional: true })
export class PersistNotificationsHandler implements MessageHandler<NotificationRequestedPayload> {
  constructor(private readonly repo: NotificationRepository, private readonly outbox: Outbox) {}

  async handle(message: OutboxEnvelope<NotificationRequestedPayload>): Promise<void> {
    const created = await this.repo.insertMany(message.payload.items);
    await this.outbox.enqueue<NotificationCreatedPayload>({
      type: MessageTypes.NOTIFICATION_CREATED,
      payload: { notificationIds: created.map((n) => n.id) },
      dedupKey: `notification.created:${message.id}`, // segurança extra contra reprocessamento
      maxAttempts: 5,
    });
  }
}
