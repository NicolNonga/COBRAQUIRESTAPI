import { bucketOf, cei, costToCollect, dso, pct } from './kpi-formulas';

describe('fórmulas de contas a receber', () => {
  it('DSO = saldo final ÷ facturação × dias', () => {
    expect(dso(1_000_000, 3_000_000, 90)).toBe(30);
    expect(dso(500, 0, 30)).toBeNull();
  });

  it('CEI: 100% quando se cobra tudo o que estava vencido', () => {
    // início 1000, facturou 500, fim 200 dos quais 200 ainda não vencidos → cobrou tudo o cobrável
    expect(cei(1000, 500, 200, 200)).toBe(100);
    // cobrou 600 de 1300 cobráveis
    expect(cei(1000, 500, 900, 200)).toBeCloseTo(46.2, 1);
    expect(cei(0, 0, 0, 0)).toBeNull();
  });

  it('percentagens e custo por cobrança', () => {
    expect(pct(25, 200)).toBe(12.5);
    expect(pct(1, 0)).toBeNull();
    expect(costToCollect(42_000, 1_000_000)).toBe(4.2);
  });

  it('faixas de aging', () => {
    expect(bucketOf(-5)).toBe('CURRENT');
    expect(bucketOf(0)).toBe('CURRENT');
    expect(bucketOf(1)).toBe('D1_30');
    expect(bucketOf(90)).toBe('D61_90');
    expect(bucketOf(181)).toBe('D180_PLUS');
  });
});
