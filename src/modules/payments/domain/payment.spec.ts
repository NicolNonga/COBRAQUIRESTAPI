import { BusinessRuleError, ValidationError } from '@/shared/domain/errors';
import { PaymentPolicy } from './payment';

describe('PaymentPolicy', () => {
  describe('allocate', () => {
    const buckets = [
      { installmentId: 2, remaining: '100.00' },
      { installmentId: 1, remaining: '100.00' },
      { installmentId: 3, remaining: '100.00' },
    ];

    it('parcial: fica na prestação indicada, sem a fechar', () => {
      expect(PaymentPolicy.allocate('40.00', buckets)).toEqual({
        allocations: [{ installmentId: 2, amount: '40.00', coversBucket: false }],
        credit: '0.00',
      });
    });

    it('excedente abate as prestações seguintes pela ordem recebida', () => {
      const r = PaymentPolicy.allocate('250.00', buckets);
      expect(r.allocations).toEqual([
        { installmentId: 2, amount: '100.00', coversBucket: true },
        { installmentId: 1, amount: '100.00', coversBucket: true },
        { installmentId: 3, amount: '50.00', coversBucket: false },
      ]);
      expect(r.credit).toBe('0.00');
    });

    it('acima de tudo o que falta → o resto fica como crédito do devedor', () => {
      const r = PaymentPolicy.allocate('330.55', buckets);
      expect(r.allocations.every((a) => a.coversBucket)).toBe(true);
      expect(r.credit).toBe('30.55');
    });

    it('ignora baldes já cobertos e, sem baldes, tudo é crédito', () => {
      expect(PaymentPolicy.allocate('10.00', [{ installmentId: 1, remaining: '0.00' }])).toEqual({ allocations: [], credit: '10.00' });
      expect(PaymentPolicy.allocate('10.00', [])).toEqual({ allocations: [], credit: '10.00' });
    });

    it('soma das alocações + crédito = valor, ao cêntimo', () => {
      const r = PaymentPolicy.allocate('0.03', [
        { installmentId: 1, remaining: '0.01' },
        { installmentId: 2, remaining: '0.01' },
      ]);
      expect(r.allocations.map((a) => a.amount)).toEqual(['0.01', '0.01']);
      expect(r.credit).toBe('0.01');
    });
  });

  describe('câmbio', () => {
    it('moeda base: taxa 1 (e rejeita outra)', () => {
      expect(PaymentPolicy.resolveExchangeRate('AOA', 'AOA')).toBe('1');
      expect(() => PaymentPolicy.resolveExchangeRate('aoa', 'AOA', '2')).toThrow(ValidationError);
    });

    it('outra moeda exige taxa; valor base arredondado a 2 casas', () => {
      expect(() => PaymentPolicy.resolveExchangeRate('USD', 'AOA')).toThrow(ValidationError);
      const rate = PaymentPolicy.resolveExchangeRate('USD', 'AOA', '912.123456');
      expect(PaymentPolicy.amountBase('10.01', rate).toString()).toBe('9130.36');
    });
  });

  it('data do comprovativo não pode ser futura nem inválida', () => {
    expect(() => PaymentPolicy.assertPaidOn('2026-10-07', '2026-10-06')).toThrow(BusinessRuleError);
    expect(() => PaymentPolicy.assertPaidOn('2026-13-01', '2026-10-06')).toThrow(ValidationError);
    expect(() => PaymentPolicy.assertPaidOn('2026-10-06', '2026-10-06')).not.toThrow();
  });

  it('comissão: % do credor sobre o valor confirmado', () => {
    expect(PaymentPolicy.commission('1000.00', '12.5').toString()).toBe('125.00');
    expect(PaymentPolicy.commission('333.33', '10').toString()).toBe('33.33');
    expect(PaymentPolicy.commission('100.00', '0').toString()).toBe('0.00');
  });

  describe('lançamentos do credor', () => {
    it('B (AGENCY): recebido + comissão retida → saldo a repassar', () => {
      expect(PaymentPolicy.creditorEntries('AGENCY', '1000.00', '100.00', '7').map((e) => [e.kind, e.amount])).toEqual([
        ['COLLECTED', '1000.00'],
        ['COMMISSION', '-100.00'],
      ]);
    });

    it('A (CREDITOR): só a comissão → o credor deve-nos', () => {
      expect(PaymentPolicy.creditorEntries('CREDITOR', '1000.00', '100.00', '7').map((e) => [e.kind, e.amount])).toEqual([['COMMISSION', '-100.00']]);
    });

    it('sem comissão não há lançamento de comissão', () => {
      expect(PaymentPolicy.creditorEntries('CREDITOR', '1000.00', '0.00', '7')).toEqual([]);
    });
  });
});
