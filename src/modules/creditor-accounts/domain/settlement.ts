import { Criteria } from '@/shared/domain/criteria';
import { BusinessRuleError, ValidationError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { Page } from '@/shared/domain/pagination';

/**
 * TO_CREDITOR   (opção B): repassamos ao credor o que recebemos em seu nome (já descontada a comissão);
 * FROM_CREDITOR (opção A): o credor paga-nos as comissões.
 */
export const SETTLEMENT_DIRECTIONS = ['TO_CREDITOR', 'FROM_CREDITOR'] as const;
export type SettlementDirection = (typeof SETTLEMENT_DIRECTIONS)[number];
export const SETTLEMENT_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export class SettlementPolicy {
  /**
   * Quanto ainda se pode acertar nesta direcção.
   *  TO_CREDITOR:   saldo positivo (devemos) − repasses pendentes
   *  FROM_CREDITOR: saldo negativo (devem-nos) − recebimentos pendentes
   */
  static available(direction: SettlementDirection, balance: string, pendingSameDirection: string): Money {
    const owed = direction === 'TO_CREDITOR' ? Money.of(balance) : Money.zero().minus(balance);
    const left = owed.minus(pendingSameDirection);
    return left.isPositive() ? left : Money.zero();
  }

  static assertWithinAvailable(direction: SettlementDirection, amount: string, available: Money): void {
    if (!Money.of(amount).isPositive()) throw new ValidationError('O valor deve ser maior que zero');
    if (Money.of(amount).gt(available)) {
      const what = direction === 'TO_CREDITOR' ? 'o saldo a repassar ao credor' : 'a comissão que o credor nos deve';
      throw new BusinessRuleError(`O valor (${Money.of(amount)}) excede ${what} (${available})`, { available: available.toString() });
    }
  }

  /** sinal no livro: repasse diminui o que devemos; recebimento diminui o que nos devem */
  static ledgerAmount(direction: SettlementDirection, amount: string): string {
    return direction === 'TO_CREDITOR' ? Money.zero().minus(amount).toString() : Money.of(amount).toString();
  }
}

export interface NewSettlement {
  organizationId: number;
  direction: SettlementDirection;
  amount: string;
  settledOn: string;
  paymentMethodId: number;
  reference: string | null;
  proofPath: string;
  notes: string | null;
  registeredById: number;
}

export interface Settlement extends NewSettlement {
  id: string;
  status: SettlementStatus;
  version: number;
  confirmedById: number | null;
  confirmedAt: Date | null;
  cancelledById: number | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  organizationName?: string;
  paymentMethodName?: string;
}

export type SettlementField = 'organizationId' | 'direction' | 'status' | 'settledOn' | 'amount' | 'registeredById' | 'createdAt' | 'organizationName' | 'reference';
export const SETTLEMENT_SORTABLE = ['createdAt', 'settledOn', 'amount'] as const;

export abstract class SettlementRepository {
  abstract paymentMethod(id: number): Promise<{ id: number; name: string; requiresReference: boolean } | null>;
  abstract create(s: NewSettlement): Promise<string>;
  abstract findById(id: string): Promise<Settlement | null>;
  abstract findForUpdate(id: string): Promise<Settlement | null>;
  abstract markConfirmed(id: string, version: number, byUserId: number): Promise<boolean>;
  abstract markCancelled(id: string, version: number, byUserId: number, reason: string): Promise<boolean>;
  abstract search(criteria: Criteria<SettlementField>): Promise<Page<Settlement>>;
}
