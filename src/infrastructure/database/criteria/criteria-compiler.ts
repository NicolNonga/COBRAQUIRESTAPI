import { Criteria, Filter, FilterOperator } from '@/shared/domain/criteria';

/** Definição de um campo filtrável: expressão SQL (whitelist) + tipo para conversão do valor. */
export interface FieldDef {
  column: string; // ex.: 'i.amount', 'lower(d.name)', 'ps.code'
  type?: 'string' | 'number' | 'decimal' | 'date' | 'boolean' | 'enum';
  /** para CONTAINS em texto: usa unaccent+ILIKE (requer extensão unaccent) */
  searchable?: boolean;
}

export type FieldMap<F extends string> = Record<F, FieldDef>;

export interface CompiledCriteria {
  where: string; // 'TRUE' se não houver filtros
  params: unknown[]; // posicionais: $start, $start+1, …
  orderBy: string;
  limit: number;
  offset: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const SQL_OP: Partial<Record<FilterOperator, string>> = {
  [FilterOperator.EQUAL]: '=',
  [FilterOperator.NOT_EQUAL]: '<>',
  [FilterOperator.GREATER]: '>',
  [FilterOperator.GREATER_OR_EQUAL]: '>=',
  [FilterOperator.LESS]: '<',
  [FilterOperator.LESS_OR_EQUAL]: '<=',
};

const CAST: Record<NonNullable<FieldDef['type']>, string> = {
  string: 'text',
  enum: 'text',
  number: 'int',
  decimal: 'numeric',
  date: 'date',
  boolean: 'boolean',
};

/**
 * Traduz Criteria → SQL parametrizado (Postgres). Único ponto do sistema que gera SQL dinâmico:
 *  - colunas só via FieldMap (whitelist) → o input do cliente nunca entra no SQL como identificador;
 *  - valores sempre como parâmetros posicionais ($n) com cast explícito → usa índices e evita injecção;
 *  - LIKE com escape de % e _.
 * Devolve SQL utilizável tanto em queries raw como em QueryBuilder (ver `applyToQueryBuilder`).
 */
export class CriteriaCompiler<F extends string> {
  constructor(private readonly fields: FieldMap<F>) {}

  compile(c: Criteria<F>, startParamIndex = 1): CompiledCriteria {
    const params: unknown[] = [];
    const p = (v: unknown, def: FieldDef) => {
      params.push(v);
      return `CAST($${startParamIndex + params.length - 1} AS ${CAST[def.type ?? 'string']})`;
    };

    const predicate = (f: Filter<F> | { field: F; operator: FilterOperator; value: unknown }): string => {
      const def = this.fields[f.field];
      if (!def) throw new Error(`Campo de filtro não permitido: ${f.field}`);
      const col = def.column;
      switch (f.operator) {
        case FilterOperator.IN:
        case FilterOperator.NOT_IN: {
          params.push(Array.isArray(f.value) ? f.value : [f.value]);
          const ph = `CAST($${startParamIndex + params.length - 1} AS ${CAST[def.type ?? 'string']}[])`;
          return f.operator === FilterOperator.IN ? `${col} = ANY(${ph})` : `NOT (${col} = ANY(${ph}))`;
        }
        case FilterOperator.CONTAINS:
        case FilterOperator.STARTS_WITH: {
          const v = escapeLike(String(f.value));
          const pattern = f.operator === FilterOperator.CONTAINS ? `%${v}%` : `${v}%`;
          params.push(pattern);
          const ph = `CAST($${startParamIndex + params.length - 1} AS text)`;
          return def.searchable ? `f_unaccent(${col}) ILIKE f_unaccent(${ph})` : `${col}::text ILIKE ${ph}`;
        }
        case FilterOperator.IS_NULL:
          return f.value === true || f.value === 'true' ? `${col} IS NULL` : `${col} IS NOT NULL`;
        default: {
          const op = SQL_OP[f.operator];
          if (!op) throw new Error(`Operador não suportado: ${f.operator}`);
          return `${col} ${op} ${p(f.value, def)}`;
        }
      }
    };

    const parts = c.filters.map((f) => predicate(f));
    for (const any of c.anyOf) {
      parts.push(`(${any.fields.map((field) => predicate({ field, operator: any.operator, value: any.value })).join(' OR ')})`);
    }

    const orderBy = c.sorts
      .map((s) => {
        const def = this.fields[s.field];
        if (!def) throw new Error(`Campo de ordenação não permitido: ${s.field}`);
        return `${def.column} ${s.direction === 'ASC' ? 'ASC' : 'DESC'} NULLS LAST`;
      })
      .join(', ');

    return {
      where: parts.length ? parts.join(' AND ') : 'TRUE',
      params,
      orderBy: orderBy || '1',
      limit: c.perPage,
      offset: (c.page - 1) * c.perPage,
    };
  }
}
