import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('categories')
export class CategoryOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) name: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('currencies')
export class CurrencyOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
  @Column({ length: 3 }) code: string; // ISO-4217 (AOA, USD, EUR)
  @Column({ length: 10 }) symbol: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('debtor_types')
export class DebtorTypeOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) description: string | null;
  @Column({ default: true }) isCompany: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('contact_types')
export class ContactTypeOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

/** Códigos estáveis: o código usa `code`, nunca o nome (que é traduzível/editável). */
export enum InvoiceStateCode {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_DISPUTE = 'IN_DISPUTE',
  PAID = 'PAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  CANCELLED = 'CANCELLED',
  OVERDUE = 'OVERDUE',
}

@Entity('invoice_states')
export class InvoiceStateOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 30 }) code: InvoiceStateCode;
  @Column({ length: 80 }) name: string;
  @Column({ default: true }) isActive: boolean;
}

export enum ProcessStateCode {
  /** estado inicial: o processo existe mas a cobrança ainda não arrancou */
  REGISTERED = 'REGISTERED',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING = 'PENDING',
  CANCELLED = 'CANCELLED',
  FINISHED = 'FINISHED',
}

@Entity('process_states')
export class ProcessStateOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 30 }) code: ProcessStateCode;
  @Column({ length: 80 }) name: string;
  @Column({ default: true }) isActive: boolean;
}
