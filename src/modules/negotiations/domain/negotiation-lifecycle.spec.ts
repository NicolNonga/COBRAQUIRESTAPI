import { FinancialCalculator } from './financial-calculator';
import { assertTransition, computeRenegotiationBalance, requiresApproval } from './negotiation-lifecycle';

const settings = { approvalDiscountLimitPercent: '10', lateMonthlyInterestPercent: '1', autoBreakEnabled: false };
const calc = new FinancialCalculator(2);

describe('requiresApproval (apenas acima do limite)', () => {
  it('no limite não exige; acima exige', () => {
    expect(requiresApproval('10', settings)).toBe(false);
    expect(requiresApproval('10.01', settings)).toBe(true);
    expect(requiresApproval('0', settings)).toBe(false);
  });
});

describe('máquina de estados', () => {
  it('permite as transições válidas', () => {
    expect(() => assertTransition('PENDING_APPROVAL', 'ACTIVE')).not.toThrow();
    expect(() => assertTransition('ACTIVE', 'BROKEN')).not.toThrow();
    expect(() => assertTransition('BROKEN', 'RENEGOTIATED')).not.toThrow();
    expect(() => assertTransition('ACTIVE', 'RENEGOTIATED')).not.toThrow();
  });
  it('rejeita as inválidas', () => {
    expect(() => assertTransition('RENEGOTIATED', 'RENEGOTIATED')).toThrow(/Transição inválida/);
    expect(() => assertTransition('PENDING_APPROVAL', 'RENEGOTIATED')).toThrow();
    expect(() => assertTransition('CANCELLED', 'ACTIVE')).toThrow();
    expect(() => assertTransition('BROKEN', 'ACTIVE')).toThrow();
  });
});

describe('saldo da renegociação ("inclui tudo")', () => {
  const neg = { isInstallment: true, finalAmount: '3000.00', startDate: '2026-01-01' };
  it('capital + multa + juros só nas prestações em atraso', () => {
    const b = computeRenegotiationBalance(
      calc,
      neg,
      [
        { installmentNumber: 1, amount: '1000.00', dueDate: '2026-08-07', penaltyPercentage: '2' }, // 60 dias → 2 meses
        { installmentNumber: 2, amount: '1000.00', dueDate: '2026-10-06', penaltyPercentage: '2' }, // vence hoje: sem encargos
        { installmentNumber: 3, amount: '1000.00', dueDate: '2026-11-06', penaltyPercentage: '2' },
      ],
      '2026-10-06',
      '1',
    );
    expect(b.lines[0]).toMatchObject({ daysLate: 60, penalty: '20.00', interest: '20.10', total: '1040.10' });
    expect(b.lines[1]).toMatchObject({ daysLate: 0, penalty: '0.00', interest: '0.00' });
    expect(b).toMatchObject({ principal: '3000.00', penalty: '20.00', interest: '20.10', total: '3040.10' });
  });
  it('acordo à vista: valor final inteiro', () => {
    const b = computeRenegotiationBalance(calc, { isInstallment: false, finalAmount: '500.00', startDate: '2026-10-06' }, [], '2026-10-06', '1');
    expect(b.total).toBe('500.00');
  });
  it('sem saldo em aberto não renegoceia', () => {
    expect(() => computeRenegotiationBalance(calc, neg, [], '2026-10-06', '1')).toThrow(/Não há saldo/);
  });
});
