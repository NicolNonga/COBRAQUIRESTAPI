import { Page, PageRequest } from '@/shared/domain/pagination';
import { NotificationOrmEntity, NotificationPriority } from '../infrastructure/notification.orm-entity';

export type Notification = NotificationOrmEntity;

export interface NewNotification {
  userId: number;
  type: string;
  title?: string;
  message: string;
  data?: Record<string, unknown>;
  actionUrl?: string;
  priority?: NotificationPriority;
}

export interface NotificationFilters {
  isRead?: boolean;
  type?: string;
  priority?: NotificationPriority;
}

export abstract class NotificationRepository {
  abstract insertMany(items: NewNotification[]): Promise<Notification[]>;
  abstract paginateForUser(userId: number, req: PageRequest, f: NotificationFilters): Promise<Page<Notification>>;
  abstract markAsRead(id: string, userId: number): Promise<boolean>;
  abstract markAllAsRead(userId: number): Promise<number>;
  abstract delete(id: string, userId: number): Promise<boolean>;
  abstract unreadCount(userId: number): Promise<number>;
  abstract deleteReadOlderThan(days: number): Promise<number>;
}
