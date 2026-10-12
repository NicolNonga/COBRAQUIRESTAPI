import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CurrencyOrmEntity, InvoiceStateOrmEntity } from '@/modules/catalogs/infrastructure/catalog.orm-entities';
import { DebtorOrmEntity } from '@/modules/debtors/infrastructure/debtor.orm-entities';
import { UserOrmEntity } from '@/modules/users/infrastructure/user.orm-entities';
import { decimalTransformer } from '@/infrastructure/database/decimal.transformer';

@Entity('invoices')
export class InvoiceOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 100 }) referenceNumber: string;
  /** NUMERIC(18,2) — nunca float/double para dinheiro */
  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: decimalTransformer }) amount: string;
  @Column({ type: 'date' }) issueDate: string;
  @Column({ type: 'int' }) timeLimitDays: number;
  @Column({ type: 'date' }) dueDate: string;
  @Column({ type: 'text', nullable: true }) documentPath: string | null;
  @Column({ default: false }) inProcess: boolean;
  @Column() debtorId: number;
  @Column() currencyId: number;
  @Column() invoiceStateId: number;
  @Column() createdById: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => DebtorOrmEntity) @JoinColumn({ name: 'debtor_id' }) debtor?: DebtorOrmEntity;
  @ManyToOne(() => CurrencyOrmEntity) @JoinColumn({ name: 'currency_id' }) currency?: CurrencyOrmEntity;
  @ManyToOne(() => InvoiceStateOrmEntity) @JoinColumn({ name: 'invoice_state_id' }) invoiceState?: InvoiceStateOrmEntity;
  @ManyToOne(() => UserOrmEntity) @JoinColumn({ name: 'created_by_id' }) createdBy?: UserOrmEntity;
}
