import { Criteria } from '@/shared/domain/criteria';
import { BusinessRuleError, ValidationError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { Page } from '@/shared/domain/pagination';

export const DISPUTE_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 *  UPHELD    procedente para o credor → a factura volta à cobrança
 *  CANCELLED o devedor tinha razão     → factura cancelada, sai da dívida
 *  ADJUSTED  valor corrigido           → novo valor e volta à cobrança
 */
export const DISPUTE_OUTCOMES = ['UPHELD', 'CANCELLED', 'ADJUSTED'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

/** Estado em que a factura fica depois da resolução. */
export type InvoiceStateAfter = 'OVERDUE' | 'IN_PROGRESS' | 'CANCELLED';

export class DisputePolicy {
  /** estados a partir dos quais se pode abrir disputa (paga/cancelada já não; em disputa já está) */
  static readonly DISPUTABLE_STATES = ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'PARTIALLY_PAID'];

  static assertDisputable(stateCode: string): void {
    if (stateCode === 'IN_DISPUTE') throw new BusinessRuleError('A factura já está em disputa');
    if (!DisputePolicy.DISPUTABLE_STATES.includes(stateCode)) throw new BusinessRuleError(`Uma factura ${stateCode} não pode ser posta em disputa`);
  }

  /** valida a decisão e diz em que estado a factura fica */
  static resolve(outcome: DisputeOutcome, originalAmount: string, adjustedAmount: string | undefined, dueDate: string, today: string): { stateAfter: InvoiceStateAfter; newAmount: string | null } {
    if (outcome === 'ADJUSTED') {
      if (!adjustedAmount) throw new ValidationError('Indique o novo valor (adjustedAmount)');
      const v = Money.of(adjustedAmount);
      if (!v.isPositive()) throw new ValidationError('O novo valor deve ser maior que zero');
      if (v.equals(originalAmount)) throw new ValidationError('O novo valor é igual ao original: use UPHELD');
    } else if (adjustedAmount) {
      throw new ValidationError('adjustedAmount só se aplica a ADJUSTED');
    }
    if (outcome === 'CANCELLED') return { stateAfter: 'CANCELLED', newAmount: null };
    return { stateAfter: dueDate < today ? 'OVERDUE' : 'IN_PROGRESS', newAmount: outcome === 'ADJUSTED' ? Money.of(adjustedAmount!).toString() : null };
  }
}

export interface InvoiceForDispute {
  id: number;
  amount: string;
  dueDate: string;
  stateCode: string;
  inProcess: boolean;
  processId: number | null;
  processHasActiveNegotiation: boolean;
}

export interface Dispute {
  id: string;
  invoiceId: number;
  processId: number | null;
  reason: string;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  originalAmount: string;
  adjustedAmount: string | null;
  resolutionNotes: string | null;
  openedById: number | null;
  openedAt: Date;
  resolvedById: number | null;
  resolvedAt: Date | null;
  version: number;
}

export interface DisputeListItem extends Dispute {
  invoiceReference: string;
  invoiceAmount: string;
  invoiceDueDate: string;
  debtorId: number;
  debtorName: string;
  organizationId: number;
  organizationName: string;
  openedByName: string | null;
  daysOpen: number;
}

export type DisputeField = 'status' | 'outcome' | 'invoiceId' | 'debtorId' | 'organizationId' | 'openedById' | 'openedAt' | 'resolvedAt' | 'invoiceReference' | 'debtorName';
export const DISPUTE_SORTABLE = ['openedAt', 'resolvedAt'] as const;

export abstract class DisputeRepository {
  /** FOR UPDATE na factura + processo actual + negociação activa */
  abstract lockInvoice(invoiceId: number): Promise<InvoiceForDispute | null>;
  /** tira a factura do processo e marca-a "Em disputa" */
  abstract detachAndMarkDisputed(invoiceId: number, processId: number | null, disputeStateId: number): Promise<void>;
  abstract insertOpen(rows: Array<{ invoiceId: number; processId: number | null; reason: string; originalAmount: string; openedById: number | null }>): Promise<string[]>;
  abstract findForUpdate(id: string): Promise<Dispute | null>;
  abstract markResolved(id: string, version: number, outcome: DisputeOutcome, adjustedAmount: string | null, notes: string, byUserId: number): Promise<boolean>;
  abstract applyToInvoice(invoiceId: number, stateId: number, newAmount: string | null): Promise<void>;
  abstract search(criteria: Criteria<DisputeField>): Promise<Page<DisputeListItem>>;
  abstract findDetailed(id: string): Promise<DisputeListItem | null>;
}

/**
 * Porta pública: o módulo de processos regista aqui as disputas quando retira facturas de um processo.
 * (As facturas já foram desligadas e marcadas "Em disputa" pelo próprio módulo de processos.)
 */
export abstract class DisputeRegistry {
  abstract recordOpened(items: Array<{ invoiceId: number; processId: number | null }>, reason: string, openedById: number | null): Promise<void>;
}
