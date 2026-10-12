import Decimal from 'decimal.js';
import { BusinessRuleError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { FinancialCalculator } from './financial-calculator';
import { NegotiationStatus } from '../infrastructure/negotiation.orm-entities';

/** Parâmetros de negócio configuráveis (sem deploy, via .env). */
export interface NegotiationSettings {
  /** acima desta % de desconto a negociação precisa de aprovação */
  approvalDiscountLimitPercent: Decimal.Value;
  /** juros de mora mensais (compostos) para o saldo da renegociação */
  lateMonthlyInterestPercent: Decimal.Value;
  /** quebra automática (desligada até existir registo de pagamentos) */
  autoBreakEnabled: boolean;
}
export const NEGOTIATION_SETTINGS = Symbol('NEGOTIATION_SETTINGS');

/** "Aprovação: apenas quando acima do limite." */
export const requiresApproval = (discountRatePercent: Decimal.Value, s: NegotiationSettings): boolean =>
  new Decimal(discountRatePercent).greaterThan(s.approvalDiscountLimitPercent);

/** Transições permitidas — tudo o resto é rejeitado (máquina de estados explícita). */
const TRANSITIONS: Record<NegotiationStatus, NegotiationStatus[]> = {
  PENDING_APPROVAL: ['ACTIVE', 'REJECTED', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED', 'BROKEN', 'RENEGOTIATED'],
  BROKEN: ['RENEGOTIATED'],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
  RENEGOTIATED: [],
};

export const assertTransition = (from: NegotiationStatus, to: NegotiationStatus): void => {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BusinessRuleError(`Transição inválida: ${from} → ${to}`);
  }
};

export interface OpenInstallment {
  installmentNumber: number;
  amount: string;
  dueDate: string; // YYYY-MM-DD
  penaltyPercentage: string;
}

export interface BalanceLine {
  installmentNumber: number | null;
  dueDate: string | null;
  daysLate: number;
  principal: string;
  penalty: string;
  interest: string;
  total: string;
}

export interface RenegotiationBalance {
  principal: string;
  penalty: string;
  interest: string;
  total: string; // = saldo de abertura (debtAmount) do novo acordo
  lines: BalanceLine[];
}

const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * "Saldo da negociação: inclui tudo" → capital em aberto + multa + juros de mora (compostos, por mês completo).
 * Prestações pagas não entram. Negociação à vista sem pagamento: o valor final inteiro.
 */
export const computeRenegotiationBalance = (
  calc: FinancialCalculator,
  neg: { isInstallment: boolean; finalAmount: string; startDate: string },
  open: OpenInstallment[],
  today: string,
  monthlyInterest: Decimal.Value,
): RenegotiationBalance => {
  const items: OpenInstallment[] = neg.isInstallment
    ? open
    : [{ installmentNumber: 0, amount: neg.finalAmount, dueDate: neg.startDate, penaltyPercentage: '0' }];
  const lines = items.map<BalanceLine>((i) => {
    const principal = Money.of(i.amount);
    const daysLate = Math.max(0, daysBetween(i.dueDate, today));
    const late = daysLate > 0 && principal.isPositive();
    const penalty = late ? calc.penalty(principal, i.penaltyPercentage) : Money.zero();
    const interest = late ? calc.compoundInterest(principal, monthlyInterest, Math.floor(daysLate / 30)) : Money.zero();
    return {
      installmentNumber: neg.isInstallment ? i.installmentNumber : null,
      dueDate: i.dueDate,
      daysLate,
      principal: principal.toString(),
      penalty: penalty.toString(),
      interest: interest.toString(),
      total: principal.plus(penalty).plus(interest).toString(),
    };
  });
  const sum = (k: 'principal' | 'penalty' | 'interest' | 'total') => Money.sum(lines.map((l) => l[k])).toString();
  const total = sum('total');
  if (!Money.of(total).isPositive()) throw new BusinessRuleError('Não há saldo em aberto para renegociar');
  return { principal: sum('principal'), penalty: sum('penalty'), interest: sum('interest'), total, lines };
};
