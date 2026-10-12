import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Money } from '@/shared/domain/money';
import { FinancialCalculator } from '../domain/financial-calculator';

/** Simulações sem persistência (ajuda o frontend a montar propostas consistentes). */
@Injectable()
export class NegotiationSimulatorUseCase {
  constructor(private readonly calc: FinancialCalculator) {}

  values(debtAmount: string, discountRate: string) {
    const debt = Money.of(debtAmount);
    const discount = this.calc.discountAmount(debt, discountRate);
    return {
      debtAmount: debt.toString(),
      discountRate: new Decimal(discountRate).toFixed(2),
      discountAmount: discount.toString(),
      totalAmount: this.calc.totalAfterDiscount(debt, discount).toString(),
    };
  }

  installments(input: { totalAmount: string; count: number; startDate: string; intervalDays?: number; penaltyPercentage?: string; type?: 'equal' | 'decreasing'; firstPercent?: string }) {
    const total = Money.of(input.totalAmount);
    const list =
      input.type === 'decreasing'
        ? this.calc.decreasingInstallments(total, input.count, input.startDate, input.firstPercent ?? 50, input.intervalDays, input.penaltyPercentage)
        : this.calc.equalInstallments(total, input.count, input.startDate, input.intervalDays, input.penaltyPercentage);
    return {
      totalAmount: total.toString(),
      installments: list.map((p) => ({
        installmentNumber: p.installmentNumber,
        installmentAmount: p.amount.toString(),
        installmentPercentage: p.percentage.toFixed(2),
        dueDate: p.dueDate,
        penaltyPercentage: p.penaltyPercentage.toFixed(2),
      })),
      sum: Money.sum(list.map((p) => p.amount)).toString(),
    };
  }

  overdue(input: { amount: string; penaltyPercentage: string; monthlyInterest: string; monthsLate: number }) {
    const r = this.calc.overdueInstallment(Money.of(input.amount), input.penaltyPercentage, input.monthlyInterest, input.monthsLate);
    return { amount: Money.of(input.amount).toString(), penalty: r.penalty.toString(), interest: r.interest.toString(), total: r.total.toString() };
  }
}
