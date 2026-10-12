import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
@Index('ix_audit_logs_entity', ['entity', 'entityId'])
@Index('ix_audit_logs_actor_created', ['actorId', 'createdAt'])
export class AuditLogOrmEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 80 })
  action: string;

  @Column({ length: 60 })
  entity: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  entityId: string | null;

  @Column({ type: 'int', nullable: true })
  actorId: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
