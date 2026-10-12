import { BadRequestException, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { PaginationQueryDto } from '@/shared/presentation/pagination.dto';
import * as U from '../application/notification.use-cases';

class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() is_read?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] }) @IsOptional() @IsIn(['low', 'medium', 'high']) priority?: 'low' | 'medium' | 'high';
}

@ApiTags('Notificações')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly listMine: U.ListMyNotificationsUseCase,
    private readonly countUnread: U.CountUnreadNotificationsUseCase,
    private readonly markRead: U.MarkNotificationReadUseCase,
    private readonly markAllRead: U.MarkAllNotificationsReadUseCase,
    private readonly deleteOne: U.DeleteNotificationUseCase,
  ) {}

  @Get()
  index(@CurrentUser() user: AuthenticatedUser, @Query() q: NotificationQueryDto) {
    return this.listMine.execute(user.id, q, { isRead: q.is_read, type: q.type, priority: q.priority });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return { count: await this.countUnread.execute(user.id) };
  }

  @Put('read-all')
  async readAll(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.markAllRead.execute(user.id);
    return { message: `${count} notificações marcadas como lidas`, count };
  }

  @Put(':id/read')
  async read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.markRead.execute(this.id(id), user.id);
    return { message: 'Notificação marcada como lida' };
  }

  @Delete(':id')
  async destroy(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.deleteOne.execute(this.id(id), user.id);
    return { message: 'Notificação removida' };
  }

  private id(v: string): string {
    if (!/^\d{1,18}$/.test(v)) throw new BadRequestException('id inválido');
    return v;
  }
}
