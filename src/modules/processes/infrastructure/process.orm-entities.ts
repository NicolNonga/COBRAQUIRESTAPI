import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContactTypeOrmEntity, ProcessStateOrmEntity } from '@/modules/catalogs/infrastructure/catalog.orm-entities';
import { DebtorOrmEntity } from '@/modules/debtors/infrastructure/debtor.orm-entities';
import { InvoiceOrmEntity } from '@/modules/invoices/infrastructure/invoice.orm-entity';
import { UserOrmEntity } from '@/modules/users/infrastructure/user.orm-entities';

@Entity('processes')
export class ProcessOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() debtorId: number;
  @Column() processStateId: number;
  @Column({ type: 'timestamptz', nullable: true }) startDate: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) endDate: Date | null;
  /** NULL = processo aberto. Índice único parcial: no máximo 1 processo aberto por devedor. */
  @Column({ type: 'timestamptz', nullable: true }) closedAt: Date | null;
  /** resumo do histórico de contactos (mantido na mesma transacção do registo do contacto) */
  @Column({ type: 'timestamptz', nullable: true }) lastContactAt: Date | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) lastContactStatus: ContactStatus | null;
  @Column({ default: 0 }) contactsCount: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => DebtorOrmEntity) @JoinColumn({ name: 'debtor_id' }) debtor?: DebtorOrmEntity;
  @ManyToOne(() => ProcessStateOrmEntity) @JoinColumn({ name: 'process_state_id' }) processState?: ProcessStateOrmEntity;
  @OneToOne(() => ProcessAssignmentOrmEntity, (a) => a.process) assignment?: ProcessAssignmentOrmEntity | null;
}

@Entity('process_invoices')
export class ProcessInvoiceOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() processId: number;
  @Column() invoiceId: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;

  @ManyToOne(() => InvoiceOrmEntity) @JoinColumn({ name: 'invoice_id' }) invoice?: InvoiceOrmEntity;
}

@Entity('process_assignments')
export class ProcessAssignmentOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() processId: number;
  @Column() userId: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @OneToOne(() => ProcessOrmEntity, (p) => p.assignment) @JoinColumn({ name: 'process_id' }) process?: ProcessOrmEntity;
  @ManyToOne(() => UserOrmEntity) @JoinColumn({ name: 'user_id' }) user?: UserOrmEntity;
}

export type TransferStatus = 'COMPLETED' | 'RETURNED' | 'CANCELLED';

@Entity('process_transfers')
export class ProcessTransferOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() processId: number;
  @Column() fromUserId: number;
  @Column() toUserId: number;
  @Column({ type: 'int', nullable: true }) performedById: number | null;
  @Column({ length: 500 }) reason: string;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ default: true }) isPermanent: boolean;
  @Column({ type: 'timestamptz', nullable: true }) returnAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) returnedAt: Date | null;
  @Column({ type: 'varchar', length: 20, default: 'COMPLETED' }) status: TransferStatus;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const CONTACT_STATUSES = ['attempted', 'answered', 'negotiation_started', 'no_answer', 'failed', 'pending'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

@Entity('contacts')
export class ContactOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() processId: number;
  @Column() userId: number;
  @Column() contactTypeId: number;
  @Column({ type: 'varchar', length: 30, default: 'pending' }) status: ContactStatus;
  @Column({ type: 'date', nullable: true }) contactDate: string | null;
  /** quando o contacto aconteceu (pode ser registado mais tarde) */
  @Column({ type: 'timestamptz' }) contactedAt: Date;
  @Column({ type: 'int', nullable: true }) durationSeconds: number | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => ContactTypeOrmEntity) @JoinColumn({ name: 'contact_type_id' }) contactType?: ContactTypeOrmEntity;
  @ManyToOne(() => UserOrmEntity) @JoinColumn({ name: 'user_id' }) user?: UserOrmEntity;
}
