import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { MessageHandler, OutboxEnvelope, OutboxHandler } from '@/shared/application/message-handler';
import { MessageTypes, NotificationCreatedPayload } from '@/shared/application/outbox.port';
import { RealTimeNotifier } from '@/shared/application/real-time-notifier.port';
import { NOTIFICATION_CREATED_EVENT } from '../application/notification-publisher.service';
import { NotificationOrmEntity } from './notification.orm-entity';

/**
 * Entrega em tempo real (Socket.IO) das notificações já persistidas.
 * A notificação existe na BD de qualquer forma; se o socket falhar, o cliente
 * vê-a no próximo GET /notifications — por isso este handler é at-least-once.
 */
@Injectable()
@OutboxHandler({ name: 'notifications.socket-push', types: [MessageTypes.NOTIFICATION_CREATED], transactional: false })
export class RealtimeNotificationHandler implements MessageHandler<NotificationCreatedPayload> {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly realtime: RealTimeNotifier) {}

  async handle(message: OutboxEnvelope<NotificationCreatedPayload>): Promise<void> {
    // 1 query para todas as notificações do evento (sem N+1)
    const rows = await this.ds.getRepository(NotificationOrmEntity).findBy({ id: In(message.payload.notificationIds) });
    rows.forEach((n) => this.realtime.emitToUser(n.userId, NOTIFICATION_CREATED_EVENT, n));
  }
}
