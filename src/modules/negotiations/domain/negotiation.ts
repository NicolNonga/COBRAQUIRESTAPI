import Decimal from 'decimal.js';
import { BusinessRuleError, ValidationError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { FinancialCalculator } from './financial-calculator';

export interface InstallmentInput {
  installmentNumber: number;
  amount: string;
  percentage: string;
  dueDate: string; // YYYY-MM-DD
  penaltyPercentage: string;
}

export interface NegotiationInput {
  debtAmount: string;
  discountAmount: string;
  discountRate: string;
  totalAmount: string;
  finalAmount: string;
  effectiveDate: string;
  startDate: string;
  endDate: string;
  isInstallment: boolean;
  isEqualInstallments: boolean;
  totalInstallments?: number | null;
  processIds: number[];
  installments?: InstallmentInput[];
  notes?: string | null;
}

/** Tolerância na percentagem informada vs recalculada (o VALOR é a fonte de verdade). */
const PERCENT_TOLERANCE = new Decimal('0.1');

/**
 * Política de criação de negociação — regras puras e exaustivas.
 * Porta do NegociacaoValidator, agora com Decimal e regras adicionais:
 *   - prestações numeradas 1..N sem repetição e vencimentos crescentes;
 *   - prestações com valor > 0;
 *   - multa limitada ao máximo configurado;
 *   - negociação "à vista" não pode trazer prestações.
 */
export class NegotiationPolicy {
  constructor(private readonly calc: FinancialCalculator) {}

  validate(input: NegotiationInput, today: string): void {
    this.validateDates(input, today);
    this.validateValues(input);
    this.validateProcesses(input);
    this.validateInstallments(input);
  }

  private validateDates(i: NegotiationInput, today: string): void {
    for (const [k, v] of Object.entries({ effectiveDate: i.effectiveDate, startDate: i.startDate, endDate: i.endDate })) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new ValidationError(`${k} inválida (formato YYYY-MM-DD)`);
    }
    if (i.effectiveDate > today) throw new BusinessRuleError('A data efectiva não pode ser futura');
    if (i.startDate < i.effectiveDate) throw new BusinessRuleError('A data de início da vigência não pode ser anterior à data efectiva do acordo');
    if (i.startDate >= i.endDate) throw new BusinessRuleError('A data de início deve ser anterior à data fim');
  }

  private validateValues(i: NegotiationInput): void {
    const debt = Money.of(i.debtAmount);
    const discount = Money.of(i.discountAmount);
    const total = Money.of(i.totalAmount);
    const final = Money.of(i.finalAmount);

    if (!debt.isPositive()) throw new BusinessRuleError('O valor da dívida deve ser maior que zero');
    if (discount.isNegative()) throw new BusinessRuleError('O valor do desconto não pode ser negativo');
    if (discount.gte(debt)) throw new BusinessRuleError(`O desconto (${discount}) não pode ser igual ou maior que a dívida (${debt})`);

    const expectedDiscount = this.calc.discountAmount(debt, i.discountRate);
    if (!discount.equals(expectedDiscount)) {
      throw new BusinessRuleError(`O desconto (${discount}) não é consistente com a taxa (${i.discountRate}% de ${debt} = ${expectedDiscount})`);
    }
    const expectedTotal = this.calc.totalAfterDiscount(debt, discount);
    if (!total.equals(expectedTotal)) {
      throw new BusinessRuleError(`O valor total (${total}) deve ser igual à dívida (${debt}) menos o desconto (${discount}) = ${expectedTotal}`);
    }
    if (!final.isPositive()) throw new BusinessRuleError('O valor final deve ser maior que zero');
    if (final.gt(total)) throw new BusinessRuleError('O valor final não pode ser maior que o valor total');
  }

  private validateProcesses(i: NegotiationInput): void {
    if (!i.processIds.length) throw new BusinessRuleError('A negociação deve ter pelo menos um processo associado');
    if (new Set(i.processIds).size !== i.processIds.length) throw new BusinessRuleError('Não é permitido processos duplicados na negociação');
  }

  private validateInstallments(i: NegotiationInput): void {
    const list = i.installments ?? [];
    if (!i.isInstallment) {
      if (list.length) throw new BusinessRuleError('Negociação a pronto não pode ter prestações');
      return;
    }
    if (!list.length) throw new BusinessRuleError('Negociação parcelada deve ter pelo menos uma prestação');
    if (!i.totalInstallments) throw new BusinessRuleError('O total de prestações tem de ser indicado para negociações parceladas');
    if (list.length !== i.totalInstallments) throw new BusinessRuleError('O número de prestações deve corresponder ao total informado');

    const total = Money.of(i.totalAmount);
    const sorted = [...list].sort((a, b) => a.installmentNumber - b.installmentNumber);
    sorted.forEach((p, idx) => {
      if (p.installmentNumber !== idx + 1) throw new BusinessRuleError('As prestações devem estar numeradas de 1 a N, sem repetições');
      if (idx > 0 && p.dueDate <= sorted[idx - 1].dueDate) throw new BusinessRuleError(`Prestação ${p.installmentNumber}: vencimento deve ser posterior ao da prestação anterior`);
      const amount = Money.of(p.amount);
      if (!amount.isPositive()) throw new BusinessRuleError(`Prestação ${p.installmentNumber}: valor deve ser maior que zero`);
      const recalculated = amount.ratioOf(total);
      if (recalculated.minus(p.percentage).abs().gt(PERCENT_TOLERANCE)) {
        throw new BusinessRuleError(`Prestação ${p.installmentNumber}: percentagem indicada (${p.percentage}%) incompatível com o valor (${amount} / ${total} = ${recalculated}%)`);
      }
      if (p.dueDate < i.startDate) throw new BusinessRuleError(`Prestação ${p.installmentNumber}: vencimento anterior ao início da negociação`);
      if (p.dueDate > i.endDate) throw new BusinessRuleError(`Prestação ${p.installmentNumber}: vencimento posterior ao fim da negociação`);
      this.calc.assertPenalty(p.penaltyPercentage);
    });

    // soma dos valores: igualdade EXACTA (aritmética decimal, sem tolerância)
    const sum = Money.sum(sorted.map((p) => p.amount));
    if (!sum.equals(total)) throw new BusinessRuleError(`A soma das prestações (${sum}) deve ser igual ao valor total (${total})`);
    const pctSum = sorted.reduce((acc, p) => acc.plus(p.percentage), new Decimal(0));
    if (pctSum.minus(100).abs().gt(PERCENT_TOLERANCE)) throw new BusinessRuleError(`A soma das percentagens (${pctSum}%) deve ser 100%`);

    this.validateEqualFlag(i, sorted);
  }

  /** a última prestação é de ajuste e não entra na comparação */
  private validateEqualFlag(i: NegotiationInput, sorted: InstallmentInput[]): void {
    if (sorted.length <= 1) return;
    const ref = Money.of(sorted[0].amount);
    const different = sorted.slice(0, -1).filter((p) => !Money.of(p.amount).equals(ref));
    const allEqual = different.length === 0;
    if (i.isEqualInstallments && !allEqual) {
      throw new BusinessRuleError(`isParcelaIgual = true mas há prestações com valores diferentes (${different.map((p) => p.installmentNumber).join(', ')})`);
    }
    if (!i.isEqualInstallments && allEqual) {
      throw new BusinessRuleError('isParcelaIgual = false mas todas as prestações têm o mesmo valor');
    }
  }
}
