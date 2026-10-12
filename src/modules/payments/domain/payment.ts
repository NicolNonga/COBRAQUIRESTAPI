import Decimal from 'decimal.js';
import { ValidationError, BusinessRuleError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';

export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Quem recebeu o dinheiro: o credor directamente (opção A) ou a empresa de cobrança (opção B). */
export const PAYMENT_RECEIVERS = ['CREDITOR', 'AGENCY'] as const;
export type PaymentReceiver = (typeof PAYMENT_RECEIVERS)[number];

/** Um "balde" a cobrir: prestação em aberto (ou o acordo à vista, installmentId = null) e quanto falta. */
export interface AllocationBucket {
  installmentId: number | null;
  remaining: string;
}

export interface Allocation {
  installmentId: number | null;
  amount: string;
  /** a alocação fecha o balde → a prestação passa a PAID */
  coversBucket: boolean;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** excedente depois de cobrir todos os baldes → crédito do devedor */
  credit: string;
}

export type CreditorEntryKind = 'COLLECTED' | 'COMMISSION';
export interface CreditorEntryDraft {
  kind: CreditorEntryKind;
  /** + devemos ao credor ; − o credor deve-nos / retemos */
  amount: string;
  description: string;
}

/**
 * Regras puras dos pagamentos (sem I/O → testáveis em unidade).
 *  - pagamento parcial é aceite e acumula;
 *  - pagamento acima do que falta NÃO é rejeitado: o excedente abate as prestações seguintes
 *    e o que sobrar fica como crédito do devedor;
 *  - o valor que abate na dívida é sempre `amountBase` (moeda base).
 */
export class PaymentPolicy {
  static amountBase(amount: string, exchangeRate: Decimal.Value): Money {
    const rate = new Decimal(exchangeRate);
    if (!rate.isFinite() || rate.lte(0)) throw new ValidationError('Taxa de câmbio inválida');
    const base = Money.of(Money.of(amount).toDecimal().times(rate));
    if (!base.isPositive()) throw new ValidationError('O valor do pagamento deve ser maior que zero');
    return base;
  }

  static resolveExchangeRate(currencyCode: string, baseCode: string, informed?: string): string {
    if (currencyCode.toUpperCase() === baseCode.toUpperCase()) {
      if (informed && !new Decimal(informed).equals(1)) throw new ValidationError(`Pagamento em ${baseCode}: a taxa de câmbio deve ser 1`);
      return '1';
    }
    if (!informed) throw new ValidationError(`Pagamento em ${currencyCode}: indique a taxa de câmbio para ${baseCode}`);
    const r = new Decimal(informed);
    if (!r.isFinite() || r.lte(0)) throw new ValidationError('Taxa de câmbio inválida');
    return r.toFixed();
  }

  /** a data é a que consta no comprovativo: não pode ser futura */
  static assertPaidOn(paidOn: string, today: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(`${paidOn}T00:00:00Z`))) throw new ValidationError('Data do pagamento inválida');
    if (paidOn > today) throw new BusinessRuleError('A data do pagamento (do comprovativo) não pode ser futura');
  }

  /**
   * Distribui o valor pelos baldes na ordem recebida (prestação indicada primeiro, depois por vencimento).
   * Σ alocações + crédito = valor, sempre ao cêntimo.
   */
  static allocate(amountBase: string, buckets: AllocationBucket[]): AllocationResult {
    let left = Money.of(amountBase);
    const allocations: Allocation[] = [];
    for (const b of buckets) {
      if (!left.isPositive()) break;
      const remaining = Money.of(b.remaining);
      if (!remaining.isPositive()) continue;
      const take = left.gt(remaining) ? remaining : left;
      allocations.push({ installmentId: b.installmentId, amount: take.toString(), coversBucket: take.equals(remaining) });
      left = left.minus(take);
    }
    return { allocations, credit: left.toString() };
  }

  static commission(amountBase: string, ratePercent: string): Money {
    const rate = new Decimal(ratePercent);
    if (rate.lt(0) || rate.gt(100)) throw new ValidationError('Taxa de comissão inválida');
    return Money.of(Money.of(amountBase).toDecimal().times(rate).div(100));
  }

  /**
   * Lançamentos na conta-corrente do credor ao confirmar.
   *  B (AGENCY):   +valor recebido em nome do credor, −comissão retida  → saldo a repassar
   *  A (CREDITOR): −comissão                                              → o credor deve-nos
   */
  static creditorEntries(receiver: PaymentReceiver, amountBase: string, commission: string, paymentId: string): CreditorEntryDraft[] {
    const out: CreditorEntryDraft[] = [];
    if (receiver === 'AGENCY') out.push({ kind: 'COLLECTED', amount: Money.of(amountBase).toString(), description: `Pagamento #${paymentId} recebido pela empresa de cobrança` });
    if (Money.of(commission).isPositive()) {
      out.push({ kind: 'COMMISSION', amount: Money.zero().minus(commission).toString(), description: `Comissão sobre o pagamento #${paymentId}` });
    }
    return out;
  }
}
