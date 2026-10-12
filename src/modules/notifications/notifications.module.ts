import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealTimeNotifier } from '@/shared/application/real-time-notifier.port';
import { NotificationPublisherService } from './application/notification-publisher.service';
import * as U from './application/notification.use-cases';
import { NotificationPublisher } from './domain/notification-publisher.port';
import { NotificationRepository } from './domain/notification.repository';
import { NotificationOrmEntity } from './infrastructure/notification.orm-entity';
import { NotificationsGateway } from './infrastructure/notifications.gateway';
import { PersistNotificationsHandler } from './infrastructure/persist-notifications.handler';
import { RealtimeNotificationHandler } from './infrastructure/realtime-notification.handler';
import { TypeOrmNotificationRepository } from './infrastructure/typeorm-notification.repository';
import { NotificationsController } from './presentation/notifications.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NotificationOrmEntity])],
  controllers: [NotificationsController],
  providers: [
    { provide: NotificationRepository, useClass: TypeOrmNotificationRepository },
    NotificationsGateway,
    PersistNotificationsHandler,
    RealtimeNotificationHandler,
    { provide: RealTimeNotifier, useExisting: NotificationsGateway },
    { provide: NotificationPublisher, useClass: NotificationPublisherService },
    U.ListMyNotificationsUseCase,
    U.CountUnreadNotificationsUseCase,
    U.MarkNotificationReadUseCase,
    U.MarkAllNotificationsReadUseCase,
    U.DeleteNotificationUseCase,
    U.PurgeOldNotificationsUseCase,
  ],
  exports: [NotificationPublisher, RealTimeNotifier, U.PurgeOldNotificationsUseCase],
})
export class NotificationsModule {}
