import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@/shared/domain/errors';
import { PageRequest } from '@/shared/domain/pagination';
import { NotificationFilters, NotificationRepository } from '../domain/notification.repository';

@Injectable()
export class ListMyNotificationsUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  execute(userId: number, req: PageRequest, filters: NotificationFilters) {
    return this.repo.paginateForUser(userId, req, filters);
  }
}

@Injectable()
export class CountUnreadNotificationsUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  execute(userId: number) {
    return this.repo.unreadCount(userId);
  }
}

@Injectable()
export class MarkNotificationReadUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  async execute(id: string, userId: number): Promise<void> {
    // filtro por userId: um utilizador não consegue marcar notificações de outro
    if (!(await this.repo.markAsRead(id, userId))) throw new NotFoundError('Notificação não encontrada');
  }
}

@Injectable()
export class MarkAllNotificationsReadUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  execute(userId: number) {
    return this.repo.markAllAsRead(userId);
  }
}

@Injectable()
export class DeleteNotificationUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  async execute(id: string, userId: number): Promise<void> {
    if (!(await this.repo.delete(id, userId))) throw new NotFoundError('Notificação não encontrada');
  }
}

@Injectable()
export class PurgeOldNotificationsUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  execute(days = 30) {
    return this.repo.deleteReadOlderThan(days);
  }
}
