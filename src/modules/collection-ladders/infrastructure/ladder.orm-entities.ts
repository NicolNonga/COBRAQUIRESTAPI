import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DebtorChannel, LadderAction, LadderPriority, LadderRecipients } from '../domain/ladder';

@Entity('collection_ladders')
export class CollectionLadderOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() ownerUserId: number;
  @Column({ length: 120 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ default: false }) isActive: boolean;
  @Column({ default: 1 }) version: number;
  /** versão da régua master contra a qual esta régua foi validada */
  @Column({ type: 'int', nullable: true }) policyVersion: number | null;
  /** false = deixou de cumprir a régua master → o motor ignora-a até ser corrigida */
  @Column({ default: true }) policyCompliant: boolean;
  @Column({ type: 'jsonb', nullable: true }) policyViolations: Array<{ code: string; message: string; dayOffset?: number }> | null;
  @Column({ type: 'timestamptz', nullable: true }) archivedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @OneToMany(() => CollectionLadderStepOrmEntity, (s) => s.ladder) steps?: CollectionLadderStepOrmEntity[];
}

@Entity('collection_ladder_steps')
export class CollectionLadderStepOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() ladderId: number;
  @Column() dayOffset: number;
  @Column({ type: 'varchar', length: 30 }) actionType: LadderAction;
  @Column({ type: 'varchar', length: 10 }) recipients: LadderRecipients;
  @Column({ type: 'varchar', length: 10, default: 'medium' }) priority: LadderPriority;
  @Column({ length: 150 }) title: string;
  @Column({ type: 'text' }) messageTemplate: string;
  @Column({ type: 'int', nullable: true }) fulfillmentDays: number | null;
  @Column({ type: 'varchar', length: 10, default: 'NONE' }) debtorChannel: DebtorChannel;
  @Column({ type: 'varchar', length: 150, nullable: true }) debtorSubject: string | null;
  @Column({ type: 'text', nullable: true }) debtorMessageTemplate: string | null;
  @Column({ type: 'timestamptz', nullable: true }) removedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => CollectionLadderOrmEntity, (l) => l.steps) @JoinColumn({ name: 'ladder_id' }) ladder?: CollectionLadderOrmEntity;
}
