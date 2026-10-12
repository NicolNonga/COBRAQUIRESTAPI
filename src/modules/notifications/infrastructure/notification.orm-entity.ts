import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type NotificationPriority = 'low' | 'medium' | 'high';

@Entity('notifications')
export class NotificationOrmEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column() userId: number;
  @Column({ length: 50 }) type: string;
  @Column({ type: 'varchar', length: 150, nullable: true }) title: string | null;
  @Column({ type: 'text' }) message: string;
  @Column({ type: 'jsonb', nullable: true }) data: Record<string, unknown> | null;
  @Column({ default: false }) isRead: boolean;
  @Column({ type: 'timestamptz', nullable: true }) readAt: Date | null;
  @Column({ type: 'varchar', length: 10, default: 'medium' }) priority: NotificationPriority;
  @Column({ type: 'varchar', length: 500, nullable: true }) actionUrl: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
