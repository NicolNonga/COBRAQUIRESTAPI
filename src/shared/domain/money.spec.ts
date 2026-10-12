import { Money } from './money';

describe('Money', () => {
  it('soma sem erro de vírgula flutuante', () => {
    expect(Money.of('0.1').plus('0.2').toString()).toBe('0.30');
  });
  it('divide em prestações cuja soma é exactamente o total', () => {
    const parts = Money.of('100.00').splitEvenly(3);
    expect(parts.map(String)).toEqual(['33.33', '33.33', '33.34']);
    expect(Money.sum(parts).toString()).toBe('100.00');
  });
  it('percentagem arredonda HALF_UP a 2 casas', () => {
    expect(Money.of('300.30').percent(10).toString()).toBe('30.03');
  });
  it('rejeita valores não numéricos', () => {
    expect(() => Money.of('abc')).toThrow();
  });
});
