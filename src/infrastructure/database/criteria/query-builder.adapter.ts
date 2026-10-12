import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { Criteria } from '@/shared/domain/criteria';
import { CriteriaCompiler } from './criteria-compiler';

/**
 * Aplica Criteria a um SelectQueryBuilder do TypeORM.
 *  - parâmetros posicionais ($n) do compilador → nomeados (:cN), formato do QueryBuilder;
 *  - usa offset/limit (e não skip/take): as listagens só fazem JOIN N:1/1:1, logo não há
 *    multiplicação de linhas e evitamos a subquery DISTINCT extra do TypeORM;
 *  - desempate final por `idColumn` → paginação estável.
 */
export const applyCriteria = <E extends ObjectLiteral, F extends string>(
  qb: SelectQueryBuilder<E>,
  compiler: CriteriaCompiler<F>,
  criteria: Criteria<F>,
  idColumn: string,
): SelectQueryBuilder<E> => {
  const c = compiler.compile(criteria);
  const named: Record<string, unknown> = {};
  const where = c.where.replace(/\$(\d+)/g, (_m, n: string) => {
    const key = `c${Number(n) - 1}`;
    named[key] = c.params[Number(n) - 1];
    return `:${key}`;
  });
  qb.andWhere(where, named);
  c.orderBy.split(', ').forEach((o, i) => {
    const m = /^(.*) (ASC|DESC) NULLS LAST$/.exec(o);
    if (!m) return;
    if (i === 0) qb.orderBy(m[1], m[2] as 'ASC' | 'DESC', 'NULLS LAST');
    else qb.addOrderBy(m[1], m[2] as 'ASC' | 'DESC', 'NULLS LAST');
  });
  qb.addOrderBy(idColumn, 'DESC');
  return qb.offset(c.offset).limit(c.limit);
};
