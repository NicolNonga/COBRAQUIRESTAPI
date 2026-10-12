import Decimal from 'decimal.js';
import { BusinessRuleError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';

export interface GeneratedInstallment {
  installmentNumber: number;
  amount: Money;
  percentage: Decimal;
  dueDate: string; // YYYY-MM-DD
  penaltyPercentage: Decimal;
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Cálculos financeiros puros (sem I/O) com aritmética decimal exacta.
 * Porta da `CalculadoraFinanceira` original, que usava `number` (IEEE-754)
 * e precisava de tolerâncias (0.005) para compensar erros de arredondamento.
 * Com Decimal as comparações monetárias são EXACTAS.
 */
export class FinancialCalculator {
  constructor(private readonly maxPenaltyPercent: Decimal.Value = 2) {}

  discountAmount(debt: Money, ratePercent: Decimal.Value): Money {
    const rate = new Decimal(ratePercent);
    if (rate.lt(0) || rate.gt(100)) throw new BusinessRuleError('Taxa de desconto deve estar entre 0 e 100');
    return debt.percent(rate);
  }

  totalAfterDiscount(debt: Money, discount: Money): Money {
    return debt.minus(discount);
  }

  discountRate(debt: Money, discount: Money): Decimal {
    return discount.ratioOf(debt);
  }

  /** valor da prestação a partir de percentagem ]0,100] */
  installmentFromPercent(total: Money, percent: Decimal.Value): Money {
    const p = new Decimal(percent);
    if (p.lte(0) || p.gt(100)) throw new BusinessRuleError(`Percentagem inválida (${p.toString()}). Deve ser > 0 e ≤ 100.`);
    return total.percent(p);
  }

  /** N prestações iguais; a última absorve o resíduo de arredondamento. */
  equalInstallments(total: Money, count: number, startDate: string, intervalDays = 30, penalty: Decimal.Value = this.maxPenaltyPercent): GeneratedInstallment[] {
    this.assertPenalty(penalty);
    return total.splitEvenly(count).map((amount, i) => ({
      installmentNumber: i + 1,
      amount,
      percentage: amount.ratioOf(total),
      dueDate: addDays(startDate, intervalDays * (i + 1)),
      penaltyPercentage: new Decimal(penalty),
    }));
  }

  /** Primeira prestação = `firstPercent`% e o restante dividido igualmente. */
  decreasingInstallments(total: Money, count: number, startDate: string, firstPercent: Decimal.Value = 50, intervalDays = 30, penalty: Decimal.Value = this.maxPenaltyPercent): GeneratedInstallment[] {
    if (count < 2) return this.equalInstallments(total, count, startDate, intervalDays, penalty);
    this.assertPenalty(penalty);
    const first = this.installmentFromPercent(total, firstPercent);
    const rest = total.minus(first).splitEvenly(count - 1);
    return [first, ...rest].map((amount, i) => ({
      installmentNumber: i + 1,
      amount,
      percentage: amount.ratioOf(total),
      dueDate: addDays(startDate, intervalDays * (i + 1)),
      penaltyPercentage: new Decimal(penalty),
    }));
  }

  /** Juros compostos sobre prestação em atraso. */
  compoundInterest(principal: Money, monthlyRatePercent: Decimal.Value, monthsLate: number): Money {
    const rate = new Decimal(monthlyRatePercent);
    if (!principal.isPositive()) throw new BusinessRuleError('O valor principal deve ser maior que zero.');
    if (rate.lt(0)) throw new BusinessRuleError('A taxa de juros mensal não pode ser negativa.');
    if (rate.gt(100)) throw new BusinessRuleError(`Taxa de juros mensal (${rate}%) excede 100%.`);
    if (!Number.isInteger(monthsLate) || monthsLate < 0) throw new BusinessRuleError('Meses em atraso inválidos.');
    if (monthsLate === 0) return Money.zero();
    const factor = rate.dividedBy(100).plus(1).pow(monthsLate);
    return Money.of(principal.toDecimal().times(factor)).minus(principal);
  }

  penalty(principal: Money, percent: Decimal.Value): Money {
    if (!principal.isPositive()) throw new BusinessRuleError('O valor principal deve ser maior que zero.');
    this.assertPenalty(percent);
    return principal.percent(percent);
  }

  overdueInstallment(original: Money, penaltyPercent: Decimal.Value, monthlyInterest: Decimal.Value, monthsLate: number) {
    const penalty = this.penalty(original, penaltyPercent);
    const interest = this.compoundInterest(original, monthlyInterest, monthsLate);
    return { penalty, interest, total: original.plus(penalty).plus(interest) };
  }

  assertPenalty(percent: Decimal.Value): void {
    const p = new Decimal(percent);
    if (p.lt(0)) throw new BusinessRuleError('A percentagem de multa não pode ser negativa.');
    if (p.gt(this.maxPenaltyPercent)) {
      throw new BusinessRuleError(`A percentagem de multa (${p}%) excede o limite configurado de ${this.maxPenaltyPercent}%.`);
    }
  }
}
