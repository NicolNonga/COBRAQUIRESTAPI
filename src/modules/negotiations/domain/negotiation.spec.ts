import { Money } from '@/shared/domain/money';
import { BusinessRuleError } from '@/shared/domain/errors';
import { FinancialCalculator } from './financial-calculator';
import { NegotiationInput, NegotiationPolicy } from './negotiation';

const calc = new FinancialCalculator(2);
const policy = new NegotiationPolicy(calc);
const TODAY = '2026-10-05';

const base = (): NegotiationInput => ({
  debtAmount: '300.30',
  discountAmount: '30.03',
  discountRate: '10',
  totalAmount: '270.27',
  finalAmount: '270.27',
  effectiveDate: '2026-10-05',
  startDate: '2026-10-05',
  endDate: '2027-01-31',
  isInstallment: true,
  isEqualInstallments: true,
  totalInstallments: 3,
  processIds: [1],
  installments: [
    { installmentNumber: 1, amount: '90.09', percentage: '33.33', dueDate: '2026-11-05', penaltyPercentage: '2' },
    { installmentNumber: 2, amount: '90.09', percentage: '33.33', dueDate: '2026-12-05', penaltyPercentage: '2' },
    { installmentNumber: 3, amount: '90.09', percentage: '33.34', dueDate: '2027-01-05', penaltyPercentage: '2' },
  ],
});

describe('NegotiationPolicy', () => {
  it('aceita negociação consistente', () => {
    expect(() => policy.validate(base(), TODAY)).not.toThrow();
  });
  it('rejeita data efectiva futura', () => {
    expect(() => policy.validate({ ...base(), effectiveDate: '2026-10-06', startDate: '2026-10-06' }, TODAY)).toThrow(BusinessRuleError);
  });
  it('rejeita desconto inconsistente com a taxa', () => {
    expect(() => policy.validate({ ...base(), discountAmount: '30.00', totalAmount: '270.30' }, TODAY)).toThrow(/não é consistente/);
  });
  it('rejeita soma de prestações diferente do total (exacta, sem tolerância)', () => {
    const i = base();
    i.installments![2].amount = '90.08';
    expect(() => policy.validate(i, TODAY)).toThrow(/soma das prestações/);
  });
  it('rejeita processos duplicados', () => {
    expect(() => policy.validate({ ...base(), processIds: [1, 1] }, TODAY)).toThrow(/duplicados/);
  });
  it('rejeita multa acima do limite', () => {
    const i = base();
    i.installments![0].penaltyPercentage = '5';
    expect(() => policy.validate(i, TODAY)).toThrow(/multa/);
  });
  it('rejeita numeração de prestações com buracos', () => {
    const i = base();
    i.installments![2].installmentNumber = 4;
    expect(() => policy.validate(i, TODAY)).toThrow(/numeradas/);
  });
  it('rejeita negociação a pronto com prestações', () => {
    expect(() => policy.validate({ ...base(), isInstallment: false }, TODAY)).toThrow(/pronto/);
  });
});

describe('FinancialCalculator', () => {
  it('gera prestações iguais com soma exacta', () => {
    const p = calc.equalInstallments(Money.of('1000.00'), 3, '2026-10-05');
    expect(p.map((x) => x.amount.toString())).toEqual(['333.33', '333.33', '333.34']);
    expect(p[0].dueDate).toBe('2026-11-04');
  });
  it('juros compostos não negativos', () => {
    expect(calc.compoundInterest(Money.of('1000'), 1, 2).toString()).toBe('20.10');
    expect(() => calc.compoundInterest(Money.of('1000'), 1, -1)).toThrow();
  });
});
