import { Criteria } from '@/shared/domain/criteria';
import { Page } from '@/shared/domain/pagination';
import { Allocation, AllocationBucket, PaymentReceiver, PaymentStatus } from './payment';

export interface LockedNegotiation {
  id: number;
  status: string;
  isInstallment: boolean;
}

export interface PaymentTarget extends LockedNegotiation {
  installmentId: number | null;
  installmentStatus: string | null;
  debtorId: number;
  organizationId: number;
}

export interface NewPayment {
  negotiationId: number;
  installmentId: number | null;
  debtorId: number;
  organizationId: number;
  receiver: PaymentReceiver;
  amount: string;
  currencyId: number;
  exchangeRate: string;
  amountBase: string;
  paymentMethodId: number;
  paidOn: string;
  reference: string | null;
  proofPath: string;
  notes: string | null;
  registeredById: number;
}

export interface Payment extends NewPayment {
  id: string;
  status: PaymentStatus;
  version: number;
  commissionRate: string | null;
  commissionAmount: string | null;
  creditAmount: string | null;
  confirmedById: number | null;
  confirmedAt: Date | null;
  cancelledById: number | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  reversedById: number | null;
  reversedAt: Date | null;
  reverseReason: string | null;
  createdAt: Date;
}

export interface ConfirmationSnapshot {
  commissionRate: string;
  commissionAmount: string;
  creditAmount: string;
}

export interface CompletionResult {
  completedNegotiationId: number | null;
  negotiationCreatedBy: number | null;
  processesClosed: number;
  invoicesPaid: number;
}

export interface PaymentAllocationView {
  id: string;
  installmentId: number | null;
  installmentNumber: number | null;
  amount: string;
  paidOn: string;
  reversedAt: Date | null;
}

export type PaymentField =
  | 'status'
  | 'receiver'
  | 'negotiationId'
  | 'installmentId'
  | 'debtorId'
  | 'organizationId'
  | 'registeredById'
  | 'paymentMethodId'
  | 'currencyId'
  | 'paidOn'
  | 'amountBase'
  | 'createdAt'
  | 'reference'
  | 'debtorName'
  | 'registrantManagerId';
export const PAYMENT_SORTABLE = ['createdAt', 'paidOn', 'amountBase'] as const;

/** Escrita/leitura do pagamento em si (estado, quem, quando). */
export abstract class PaymentRepository {
  /** FOR UPDATE no acordo. Ordem de locks em todo o módulo: acordo → pagamento → prestações (sem ciclos → sem deadlocks). */
  abstract lockNegotiation(negotiationId: number): Promise<LockedNegotiation | null>;
  /** bloqueia acordo (+ prestação indicada) e resolve devedor/credor do acordo */
  abstract lockTarget(negotiationId: number, installmentId: number | null): Promise<PaymentTarget | null>;
  abstract create(p: NewPayment): Promise<string>;
  abstract findById(id: string): Promise<Payment | null>;
  abstract findForUpdate(id: string): Promise<Payment | null>;
  abstract markConfirmed(id: string, version: number, byUserId: number, snap: ConfirmationSnapshot): Promise<boolean>;
  abstract markCancelled(id: string, version: number, byUserId: number, reason: string): Promise<boolean>;
  abstract markReversed(id: string, version: number, byUserId: number, reason: string): Promise<boolean>;
  abstract search(criteria: Criteria<PaymentField>): Promise<Page<Payment>>;
  abstract allocationsOf(paymentId: string): Promise<PaymentAllocationView[]>;
}

/** Efeitos da confirmação/estorno sobre o acordo, as prestações, os processos e as facturas. */
export abstract class PaymentSettlementRepository {
  /**
   * Baldes em aberto do acordo, bloqueados FOR UPDATE: prestação indicada primeiro, depois por vencimento.
   * Acordo à vista: um balde (valor final − alocado).
   */
  abstract openBuckets(negotiationId: number, isInstallment: boolean, firstInstallmentId: number | null): Promise<AllocationBucket[]>;
  abstract saveAllocations(paymentId: string, negotiationId: number, paidOn: string, allocations: Allocation[]): Promise<void>;
  abstract markInstallmentsPaid(installmentIds: number[]): Promise<number>;
  /** acordo ACTIVE totalmente coberto → COMPLETED → processos Finalizados → facturas Liquidadas (1 statement) */
  abstract completeIfSettled(negotiationId: number, finishedProcessStateId: number, paidInvoiceStateId: number): Promise<CompletionResult>;

  /** marca reversed_at nas alocações do pagamento e devolve as prestações afectadas */
  abstract reverseAllocations(paymentId: string): Promise<number[]>;
  /** prestações PAID que deixaram de estar cobertas → PENDING (ou OVERDUE se já venceram) */
  abstract reopenInstallments(installmentIds: number[], today: string): Promise<number>;
  /**
   * Acordo COMPLETED que deixou de estar coberto → ACTIVE; processos reabertos; facturas Em curso.
   * Lança BusinessRuleError se o devedor já tiver outro processo aberto.
   */
  abstract reopenNegotiation(negotiationId: number, inProgressProcessStateId: number, inProgressInvoiceStateId: number): Promise<boolean>;
}

export interface DebtorCreditEntry {
  debtorId: number;
  organizationId: number;
  negotiationId: number | null;
  paymentId: string | null;
  kind: 'OVERPAYMENT' | 'REVERSAL' | 'APPLIED';
  amount: string;
  description: string;
  createdById: number | null;
}

/** Livro de crédito do devedor (append-only). */
export abstract class DebtorCreditRepository {
  /** advisory lock por devedor: serializa movimentos de crédito do mesmo devedor */
  abstract lock(debtorId: number): Promise<void>;
  abstract add(entry: DebtorCreditEntry): Promise<void>;
  abstract balanceOf(debtorId: number): Promise<string>;
  abstract statement(debtorId: number, page: number, perPage: number): Promise<Page<DebtorCreditEntry & { id: string; createdAt: Date }>>;
}

export interface PaymentMethod {
  id: number;
  name: string;
  description: string | null;
  requiresReference: boolean;
  isActive: boolean;
}

export abstract class PaymentMethodRepository {
  abstract findActive(id: number): Promise<PaymentMethod | null>;
  abstract list(onlyActive: boolean): Promise<PaymentMethod[]>;
  abstract create(data: Omit<PaymentMethod, 'id' | 'isActive'>): Promise<PaymentMethod>;
  abstract update(id: number, data: Partial<Omit<PaymentMethod, 'id'>>): Promise<boolean>;
}

export interface CurrencyRow {
  id: number;
  code: string;
  name: string;
  symbol: string;
  isActive: boolean;
}

export abstract class CurrencyAdminRepository {
  abstract findActive(id: number): Promise<CurrencyRow | null>;
  abstract list(onlyActive: boolean): Promise<CurrencyRow[]>;
  abstract create(data: Omit<CurrencyRow, 'id' | 'isActive'>): Promise<CurrencyRow>;
  abstract update(id: number, data: Partial<Omit<CurrencyRow, 'id' | 'code'>>): Promise<boolean>;
}
