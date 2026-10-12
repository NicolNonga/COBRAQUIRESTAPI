import { Criteria } from '@/shared/domain/criteria';
import { Page } from '@/shared/domain/pagination';
import { NegotiationOrmEntity, NegotiationStatus } from '../infrastructure/negotiation.orm-entities';
import { OpenInstallment } from './negotiation-lifecycle';
import { NegotiationInput } from './negotiation';

export type Negotiation = NegotiationOrmEntity;

export interface PaymentSummary {
  pending: number;
  confirmed: number;
  allocated: string;
}

export abstract class NegotiationRepository {
  abstract create(
    input: NegotiationInput,
    createdById: number | null,
    opts?: { status?: Extract<NegotiationStatus, 'ACTIVE' | 'PENDING_APPROVAL'>; previousNegotiationId?: number },
  ): Promise<Negotiation>;
  abstract approve(id: number, expectedVersion: number, approverId: number): Promise<boolean>;
  abstract reject(id: number, expectedVersion: number, approverId: number, reason: string): Promise<boolean>;
  /** quebra manual; liberta os processos para renegociação */
  abstract break(id: number, expectedVersion: number, byUserId: number, reason: string): Promise<boolean>;
  /** quebra automática de TODOS os acordos com prestação vencida (set-based, idempotente) */
  abstract autoBreakOverdue(today: string): Promise<Array<{ negotiationId: number; createdById: number | null }>>;
  abstract markRenegotiated(id: number, expectedVersion: number): Promise<boolean>;
  abstract openInstallments(id: number): Promise<OpenInstallment[]>;
  /** pagamentos do acordo: pendentes, confirmados e total alocado (moeda base) */
  abstract paymentSummary(id: number): Promise<PaymentSummary>;
  abstract processIdsOf(id: number): Promise<number[]>;
  /** processos (de entre `ids`) que já estão numa negociação activa */
  abstract processesInActiveNegotiation(ids: number[]): Promise<number[]>;
  /** cancela (lock optimista por versão) e liberta os processos */
  abstract cancel(id: number, expectedVersion: number): Promise<boolean>;
  abstract findForUpdate(id: number): Promise<Negotiation | null>;
}

export interface NegotiationListItem {
  id: number;
  status: string;
  /** valor original da dívida (antes do desconto) */
  debtAmount: string;
  totalAmount: string;
  finalAmount: string;
  discountRate: string;
  isInstallment: boolean;
  totalInstallments: number | null;
  effectiveDate: string;
  startDate: string;
  endDate: string;
  createdAt: Date;
  processesCount: number;
  debtor: { name: string; nif: string | null } | null;
}

export type NegotiationField = 'status' | 'debtAmount' | 'totalAmount' | 'finalAmount' | 'effectiveDate' | 'createdAt' | 'updatedAt' | 'createdById' | 'isInstallment' | 'debtorId' | 'debtorName' | 'debtorNif';
export const NEGOTIATION_SORTABLE = ['createdAt', 'updatedAt', 'debtAmount', 'totalAmount', 'effectiveDate', 'debtorName'] as const;

/** Situação de pagamento de uma prestação (valores na moeda base). */
export type InstallmentPaymentState = 'PAID' | 'PARTIALLY_PAID' | 'UNPAID' | 'CANCELLED';
export interface InstallmentPaymentView {
  /** confirmado e alocado a esta prestação */
  paidAmount: string;
  /** pagamentos registados para esta prestação que aguardam confirmação */
  pendingAmount: string;
  /** em falta = valor − pago (0 se paga ou cancelada) */
  remainingAmount: string;
  paymentState: InstallmentPaymentState;
}

export interface NegotiationPaymentTotals {
  finalAmount: string;
  paidAmount: string;
  pendingAmount: string;
  remainingAmount: string;
  /** excedentes que ficaram como crédito do devedor */
  creditGenerated: string;
  /** % pago do valor final (0–100) */
  progressPercent: string;
  pendingPayments: number;
  confirmedPayments: number;
}

/** Resumo das facturas de um processo (agregado na BD — nunca a lista completa no detalhe). */
export interface ProcessInvoicesSummary {
  count: number;
  /** total por moeda (facturas podem estar em moedas diferentes) */
  totals: Array<{ currency: string; count: number; amount: string }>;
  byState: Array<{ state: string; currency: string; count: number; amount: string }>;
}

export type NegotiationDetail = Negotiation & {
  installments?: Array<NonNullable<Negotiation['installments']>[number] & InstallmentPaymentView>;
  paymentTotals: NegotiationPaymentTotals;
};

export interface NegotiationInvoiceRow {
  id: number;
  processId: number;
  referenceNumber: string;
  amount: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  state: string;
  stateName: string;
  hasDocument: boolean;
}

export abstract class NegotiationQueries {
  abstract search(criteria: Criteria<NegotiationField>): Promise<Page<NegotiationListItem>>;
  /**
   * Detalhe: acordo, prestações com "pago / em falta", processos com RESUMO das facturas.
   * Nº fixo de queries pequenas, independente do nº de facturas (as facturas paginam-se em invoicesOf).
   */
  abstract findDetailed(id: number): Promise<NegotiationDetail | null>;
  /** facturas dos processos do acordo, paginadas (1 query + 1 count, só as colunas necessárias) */
  abstract invoicesOf(negotiationId: number, page: number, perPage: number, state?: string): Promise<Page<NegotiationInvoiceRow>>;
}
