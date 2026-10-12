import { Criteria } from '@/shared/domain/criteria';
import { Page } from '@/shared/domain/pagination';

export type CreditorLedgerKind = 'COLLECTED' | 'COMMISSION' | 'SETTLEMENT';

export interface CreditorLedgerEntry {
  organizationId: number;
  kind: CreditorLedgerKind;
  /** + devemos ao credor ; − o credor deve-nos */
  amount: string;
  paymentId?: string | null;
  settlementId?: string | null;
  description: string;
}

/**
 * Porta pública da conta-corrente por credor, usada pelo módulo de pagamentos.
 * Livro append-only: correcções são lançamentos inversos, nunca UPDATE/DELETE.
 */
export abstract class CreditorLedger {
  abstract commissionRateOf(organizationId: number): Promise<string>;
  abstract record(entries: CreditorLedgerEntry[]): Promise<void>;
  /** lança o inverso de todos os movimentos do pagamento (estorno) */
  abstract reversePayment(paymentId: string, description: string): Promise<number>;
}

export interface CreditorBalance {
  organizationId: number;
  organizationName: string;
  commissionRate: string;
  /** Σ livro: > 0 devemos ao credor ; < 0 o credor deve-nos */
  balance: string;
  collected: string;
  commission: string;
  settled: string;
  pendingToCreditor: string;
  pendingFromCreditor: string;
}

export type CreditorBalanceField = 'organizationId' | 'organizationName';

export interface LedgerLine extends CreditorLedgerEntry {
  id: string;
  createdAt: Date;
}

/** Leitura e administração da conta-corrente (só usada dentro do módulo). */
export abstract class CreditorAccounts {
  /** FOR UPDATE na organização: serializa acertos do mesmo credor */
  abstract lockCreditor(organizationId: number): Promise<{ id: number; name: string } | null>;
  abstract balances(criteria: Criteria<CreditorBalanceField>): Promise<Page<CreditorBalance>>;
  abstract balanceOf(organizationId: number): Promise<CreditorBalance | null>;
  abstract statement(organizationId: number, page: number, perPage: number, from?: string, to?: string): Promise<Page<LedgerLine>>;
  abstract setCommissionRate(organizationId: number, rate: string): Promise<string | null>;
}
