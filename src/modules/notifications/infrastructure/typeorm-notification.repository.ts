import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThan } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { buildPage, offsetOf, Page, PageRequest } from '@/shared/domain/pagination';
import { NewNotification, Notification, NotificationFilters, NotificationRepository } from '../domain/notification.repository';
import { NotificationOrmEntity } from './notification.orm-entity';

@Injectable()
export class TypeOrmNotificationRepository extends BaseTypeOrmRepository implements NotificationRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async insertMany(items: NewNotification[]): Promise<Notification[]> {
    if (!items.length) return [];
    const r = await this.repo(NotificationOrmEntity)
      .createQueryBuilder()
      .insert()
      .values(items.map((i) => ({ priority: 'medium' as const, ...i })) as never)
      .returning('*')
      .execute();
    return r.raw.map((row: Record<string, unknown>) => this.repo(NotificationOrmEntity).create({
      id: String(row.id),
      userId: row.user_id as number,
      type: row.type as string,
      title: row.title as string | null,
      message: row.message as string,
      data: row.data as Record<string, unknown> | null,
      isRead: row.is_read as boolean,
      readAt: row.read_at as Date | null,
      priority: row.priority as Notification['priority'],
      actionUrl: row.action_url as string | null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }));
  }

  async paginateForUser(userId: number, req: PageRequest, f: NotificationFilters): Promise<Page<Notification>> {
    // usa o índice (user_id, created_at DESC)
    const [rows, total] = await this.repo(NotificationOrmEntity).findAndCount({
      where: {
        userId,
        ...(f.isRead !== undefined ? { isRead: f.isRead } : {}),
        ...(f.type ? { type: f.type } : {}),
        ...(f.priority ? { priority: f.priority } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: offsetOf(req),
      take: req.perPage,
    });
    return buildPage(rows, total, req);
  }

  async markAsRead(id: string, userId: number): Promise<boolean> {
    const r = await this.repo(NotificationOrmEntity).update({ id, userId }, { isRead: true, readAt: () => 'now()' } as never);
    return (r.affected ?? 0) > 0;
  }

  async markAllAsRead(userId: number): Promise<number> {
    const r = await this.repo(NotificationOrmEntity).update({ userId, isRead: false }, { isRead: true, readAt: () => 'now()' } as never);
    return r.affected ?? 0;
  }

  async delete(id: string, userId: number): Promise<boolean> {
    return ((await this.repo(NotificationOrmEntity).delete({ id, userId })).affected ?? 0) > 0;
  }

  unreadCount(userId: number): Promise<number> {
    // índice parcial ix_notifications_user_unread → index-only count
    return this.repo(NotificationOrmEntity).countBy({ userId, isRead: false });
  }

  async deleteReadOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    return (await this.repo(NotificationOrmEntity).delete({ isRead: true, createdAt: LessThan(cutoff) })).affected ?? 0;
  }
}
