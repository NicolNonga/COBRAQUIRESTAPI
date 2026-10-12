import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { decimalTransformer } from '@/infrastructure/database/decimal.transformer';
import { CurrencyOrmEntity } from '@/modules/catalogs/infrastructure/catalog.orm-entities';
import { UserOrmEntity } from '@/modules/users/infrastructure/user.orm-entities';
import { PaymentReceiver, PaymentStatus } from '../domain/payment';

@Entity('payment_methods')
export class PaymentMethodOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ default: true }) requiresReference: boolean;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('payments')
export class PaymentOrmEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column() negotiationId: number;
  @Column({ type: 'int', nullable: true }) installmentId: number | null;
  @Column() debtorId: number;
  @Column() organizationId: number;
  @Column({ type: 'varchar', length: 10 }) receiver: PaymentReceiver;
  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: decimalTransformer }) amount: string;
  @Column() currencyId: number;
  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: decimalTransformer }) exchangeRate: string;
  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: decimalTransformer }) amountBase: string;
  @Column() paymentMethodId: number;
  @Column({ type: 'date' }) paidOn: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) reference: string | null;
  @Column({ type: 'text' }) proofPath: string;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' }) status: PaymentStatus;
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: decimalTransformer }) commissionRate: string | null;
  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true, transformer: decimalTransformer }) commissionAmount: string | null;
  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true, transformer: decimalTransformer }) creditAmount: string | null;
  @Column() registeredById: number;
  @Column({ type: 'int', nullable: true }) confirmedById: number | null;
  @Column({ type: 'timestamptz', nullable: true }) confirmedAt: Date | null;
  @Column({ type: 'int', nullable: true }) cancelledById: number | null;
  @Column({ type: 'timestamptz', nullable: true }) cancelledAt: Date | null;
  @Column({ type: 'text', nullable: true }) cancelReason: string | null;
  @Column({ type: 'int', nullable: true }) reversedById: number | null;
  @Column({ type: 'timestamptz', nullable: true }) reversedAt: Date | null;
  @Column({ type: 'text', nullable: true }) reverseReason: string | null;
  @Column({ default: 1 }) version: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => PaymentMethodOrmEntity) @JoinColumn({ name: 'payment_method_id' }) paymentMethod?: PaymentMethodOrmEntity;
  @ManyToOne(() => CurrencyOrmEntity) @JoinColumn({ name: 'currency_id' }) currency?: CurrencyOrmEntity;
  @ManyToOne(() => UserOrmEntity) @JoinColumn({ name: 'registered_by_id' }) registeredBy?: UserOrmEntity;
}
