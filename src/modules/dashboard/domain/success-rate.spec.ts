import { successRate } from './success-rate';

describe('successRate (por valor)', () => {
  it('recuperado ÷ posto em cobrança × 100, 2 casas', () => {
    expect(successRate('250.00', '1000.00')).toBe('25.00');
    expect(successRate('1', '3')).toBe('33.33');
  });
  it('sem valor posto em cobrança → null', () => {
    expect(successRate('100.00', '0')).toBeNull();
  });
  it('pode passar de 100% (recuperação de processos antigos)', () => {
    expect(successRate('1500', '1000')).toBe('150.00');
  });
});
