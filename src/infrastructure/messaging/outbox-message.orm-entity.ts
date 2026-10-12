import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'DEAD';

@Entity('outbox_messages')
export class OutboxMessageOrmEntity {
  @PrimaryColumn('uuid') id: string;
  @Column({ length: 100 }) type: string;
  @Column({ type: 'jsonb', nullable: true }) payload: unknown;
  @Column({ default: false }) encrypted: boolean;
  @Column({ type: 'varchar', length: 200, nullable: true }) dedupKey: string | null;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' }) status: OutboxStatus;
  @Column({ default: 0 }) attempts: number;
  @Column({ default: 10 }) maxAttempts: number;
  @Column({ type: 'timestamptz' }) availableAt: Date;
  @Column({ type: 'varchar', length: 100, nullable: true }) lockedBy: string | null;
  @Column({ type: 'timestamptz', nullable: true }) lockedUntil: Date | null;
  @Column({ type: 'text', nullable: true }) lastError: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) requestId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) processedAt: Date | null;
}

@Entity('inbox_messages')
export class InboxMessageOrmEntity {
  @PrimaryColumn('uuid') messageId: string;
  @PrimaryColumn({ length: 100 }) handler: string;
  @Column({ type: 'timestamptz' }) processedAt: Date;
}
