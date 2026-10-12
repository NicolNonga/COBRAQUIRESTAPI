import { ValueTransformer } from 'typeorm';

/**
 * NUMERIC → string. Mantemos o valor exacto como string (o `pg` já o devolve assim)
 * e convertemos para `Money` no domínio. Nunca para `number`.
 */
export const decimalTransformer: ValueTransformer = {
  to: (v: unknown) => (v === null || v === undefined ? v : String(v)),
  from: (v: string | null) => v,
};
