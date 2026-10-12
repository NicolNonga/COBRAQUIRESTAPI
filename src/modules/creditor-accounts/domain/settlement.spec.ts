import { BusinessRuleError } from '@/shared/domain/errors';
import { SettlementPolicy } from './settlement';

describe('SettlementPolicy', () => {
  it('repasse: disponível = saldo positivo − repasses pendentes', () => {
    expect(SettlementPolicy.available('TO_CREDITOR', '900.00', '300.00').toString()).toBe('600.00');
    expect(SettlementPolicy.available('TO_CREDITOR', '-50.00', '0').toString()).toBe('0.00');
  });

  it('recebimento de comissão: disponível = saldo negativo (o credor deve-nos) − pendentes', () => {
    expect(SettlementPolicy.available('FROM_CREDITOR', '-120.00', '20.00').toString()).toBe('100.00');
    expect(SettlementPolicy.available('FROM_CREDITOR', '500.00', '0').toString()).toBe('0.00');
  });

  it('rejeita acima do disponível', () => {
    const available = SettlementPolicy.available('TO_CREDITOR', '100.00', '0');
    expect(() => SettlementPolicy.assertWithinAvailable('TO_CREDITOR', '100.01', available)).toThrow(BusinessRuleError);
    expect(() => SettlementPolicy.assertWithinAvailable('TO_CREDITOR', '100.00', available)).not.toThrow();
  });

  it('sinal no livro', () => {
    expect(SettlementPolicy.ledgerAmount('TO_CREDITOR', '50.00')).toBe('-50.00');
    expect(SettlementPolicy.ledgerAmount('FROM_CREDITOR', '50.00')).toBe('50.00');
  });
});
