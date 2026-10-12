import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { decimalTransformer } from '@/infrastructure/database/decimal.transformer';
import { ProcessOrmEntity } from '@/modules/processes/infrastructure/process.orm-entities';

export const NEGOTIATION_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'CANCELLED', 'COMPLETED', 'BROKEN', 'RENEGOTIATED'] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];
export type InstallmentStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';

const money = { type: 'numeric' as const, precision: 18, scale: 2, transformer: decimalTransformer };
const pct = { type: 'numeric' as const, precision: 7, scale: 4, transformer: decimalTransformer };

@Entity('negotiations')
export class NegotiationOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column(money) debtAmount: string;
  @Column(money) discountAmount: string;
  @Column(pct) discountRate: string;
  @Column(money) totalAmount: string;
  @Column(money) finalAmount: string;
  @Column({ type: 'date' }) effectiveDate: string;
  @Column({ type: 'date' }) startDate: string;
  @Column({ type: 'date' }) endDate: string;
  @Column({ default: false }) isInstallment: boolean;
  @Column({ default: false }) isEqualInstallments: boolean;
  @Column({ type: 'int', nullable: true }) totalInstallments: number | null;
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' }) status: NegotiationStatus;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'int', nullable: true }) createdById: number | null;
  @Column({ type: 'timestamptz', nullable: true }) cancelledAt: Date | null;
  /** renegociação: acordo que este substitui (cadeia acordo 1 → 2 → 3) */
  @Column({ type: 'int', nullable: true }) previousNegotiationId: number | null;
  /** aprovação a quatro olhos (authorizedById ≠ createdById, garantido na BD) */
  @Column({ type: 'int', nullable: true }) authorizedById: number | null;
  @Column({ type: 'timestamptz', nullable: true }) approvedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) rejectedAt: Date | null;
  @Column({ type: 'text', nullable: true }) rejectionReason: string | null;
  @Column({ type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) brokenAt: Date | null;
  /** NULL = quebra automática pelo job */
  @Column({ type: 'int', nullable: true }) brokenById: number | null;
  @Column({ type: 'text', nullable: true }) breakReason: string | null;
  @Column({ type: 'timestamptz', nullable: true }) renegotiatedAt: Date | null;
  /** lock optimista para alterações futuras (pagamentos, cancelamento) */
  @VersionColumn() version: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @OneToMany(() => NegotiationProcessOrmEntity, (np) => np.negotiation) processes?: NegotiationProcessOrmEntity[];
  @OneToMany(() => NegotiationInstallmentOrmEntity, (i) => i.negotiation) installments?: NegotiationInstallmentOrmEntity[];
}

@Entity('negotiation_processes')
export class NegotiationProcessOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() negotiationId: number;
  @Column() processId: number;
  /** índice único parcial: um processo só pode estar em UMA negociação activa */
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;

  @ManyToOne(() => NegotiationOrmEntity, (n) => n.processes) @JoinColumn({ name: 'negotiation_id' }) negotiation?: NegotiationOrmEntity;
  @ManyToOne(() => ProcessOrmEntity) @JoinColumn({ name: 'process_id' }) process?: ProcessOrmEntity;
}

@Entity('negotiation_installments')
export class NegotiationInstallmentOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() negotiationId: number;
  @Column() installmentNumber: number;
  @Column(money) amount: string;
  @Column(pct) percentage: string;
  @Column({ type: 'date' }) dueDate: string;
  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: decimalTransformer }) penaltyPercentage: string;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' }) status: InstallmentStatus;
  @Column({ type: 'timestamptz', nullable: true }) paidAt: Date | null;
  @VersionColumn() version: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => NegotiationOrmEntity, (n) => n.installments) @JoinColumn({ name: 'negotiation_id' }) negotiation?: NegotiationOrmEntity;
}
