import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type IdempotencyStatus = 'IN_PROGRESS' | 'COMPLETED';

@Entity('idempotency_keys')
@Index('ux_idempotency_keys_scope_key', ['scope', 'key'], { unique: true })
@Index('ix_idempotency_keys_created_at', ['createdAt'])
export class IdempotencyKeyOrmEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** utilizador + rota: a mesma chave em rotas diferentes não colide */
  @Column({ length: 200 })
  scope: string;

  @Column({ length: 100 })
  key: string;

  @Column({ length: 64 })
  requestHash: string;

  @Column({ length: 20 })
  status: IdempotencyStatus;

  @Column({ type: 'int', nullable: true })
  responseStatus: number | null;

  @Column({ type: 'jsonb', nullable: true })
  responseBody: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
