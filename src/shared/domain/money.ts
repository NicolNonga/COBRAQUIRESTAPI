import Decimal from 'decimal.js';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/**
 * Valor monetário imutável baseado em decimal de precisão arbitrária.
 *
 * Nunca usamos `number` (IEEE-754) para dinheiro: 0.1 + 0.2 !== 0.3.
 * Na base de dados os valores são NUMERIC(18,2) e o driver `pg` devolve-os
 * como string, que é convertida directamente para Decimal sem perda.
 */
export class Money {
  static readonly SCALE = 2;
  private constructor(private readonly value: Decimal) {}

  static of(v: Decimal.Value | Money): Money {
    if (v instanceof Money) return v;
    const d = new Decimal(v);
    if (!d.isFinite()) throw new Error(`Valor monetário inválido: ${String(v)}`);
    return new Money(d.toDecimalPlaces(Money.SCALE));
  }

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  static sum(values: Array<Money | Decimal.Value>): Money {
    return values.reduce<Money>((acc, v) => acc.plus(Money.of(v)), Money.zero());
  }

  plus(o: Money | Decimal.Value): Money {
    return new Money(this.value.plus(Money.of(o).value).toDecimalPlaces(Money.SCALE));
  }
  minus(o: Money | Decimal.Value): Money {
    return new Money(this.value.minus(Money.of(o).value).toDecimalPlaces(Money.SCALE));
  }
  /** percentagem (ex.: 12.5 → 12,5%) */
  percent(p: Decimal.Value): Money {
    return new Money(this.value.times(p).dividedBy(100).toDecimalPlaces(Money.SCALE));
  }
  times(f: Decimal.Value): Money {
    return new Money(this.value.times(f).toDecimalPlaces(Money.SCALE));
  }
  /** razão percentagem deste valor relativamente a `total` (2 casas) */
  ratioOf(total: Money): Decimal {
    if (total.isZero()) return new Decimal(0);
    return this.value.dividedBy(total.value).times(100).toDecimalPlaces(2);
  }
  /** divide em `n` partes iguais; a última absorve o resíduo de arredondamento */
  splitEvenly(n: number): Money[] {
    if (!Number.isInteger(n) || n <= 0) throw new Error('Número de prestações deve ser um inteiro positivo.');
    const part = this.value.dividedBy(n).toDecimalPlaces(Money.SCALE, Decimal.ROUND_DOWN);
    const parts = Array.from({ length: n }, () => new Money(part));
    const remainder = this.minus(Money.sum(parts));
    parts[n - 1] = parts[n - 1].plus(remainder);
    return parts;
  }

  equals(o: Money | Decimal.Value): boolean {
    return this.value.equals(Money.of(o).value);
  }
  gt(o: Money | Decimal.Value): boolean {
    return this.value.greaterThan(Money.of(o).value);
  }
  gte(o: Money | Decimal.Value): boolean {
    return this.value.greaterThanOrEqualTo(Money.of(o).value);
  }
  lt(o: Money | Decimal.Value): boolean {
    return this.value.lessThan(Money.of(o).value);
  }
  lte(o: Money | Decimal.Value): boolean {
    return this.value.lessThanOrEqualTo(Money.of(o).value);
  }
  isZero(): boolean {
    return this.value.isZero();
  }
  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }
  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  /** representação canónica para a base de dados / API: "1234.50" */
  toString(): string {
    return this.value.toFixed(Money.SCALE);
  }
  toJSON(): string {
    return this.toString();
  }
  toDecimal(): Decimal {
    return this.value;
  }
}
