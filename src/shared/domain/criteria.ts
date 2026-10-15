/**
 * Criteria / Specification de pesquisa — independente de base de dados.
 *
 *   const criteria = Criteria.for<InvoiceField>()
 *     .add('status', q.status, FilterOperator.EQUAL)
 *     .add('amount', q.minAmount, FilterOperator.GREATER_OR_EQUAL)
 *     .add('dueDate', q.dueDateTo, FilterOperator.LESS_OR_EQUAL)
 *     .orderBy(q.sort, 'createdAt:desc')
 *     .paginate(q.page, q.perPage)
 *     .build();
 *
 * - Valores `undefined`, `null`, `''` ou listas vazias são ignorados → filtros opcionais sem `if`.
 * - O tipo genérico `F` limita os campos aos permitidos para o recurso (erro de compilação se não existir).
 * - A tradução para SQL é feita na infraestrutura (CriteriaCompiler) através de um mapa campo→coluna
 *   explícito: o cliente nunca escolhe colunas nem operadores fora da lista (sem SQL injection).
 */
export enum FilterOperator {
  EQUAL = 'eq',
  NOT_EQUAL = 'ne',
  GREATER = 'gt',
  GREATER_OR_EQUAL = 'gte',
  LESS = 'lt',
  LESS_OR_EQUAL = 'lte',
  IN = 'in',
  NOT_IN = 'notIn',
  CONTAINS = 'contains', // ILIKE %v% (case/acentos-insensitive se a coluna o suportar)
  STARTS_WITH = 'startsWith', // ILIKE v%
  IS_NULL = 'isNull', // value=true → IS NULL ; false → IS NOT NULL
}

export type SortDirection = 'ASC' | 'DESC';

export interface Filter<F extends string = string> {
  field: F;
  operator: FilterOperator;
  value: unknown;
}

/** OR de vários campos com o mesmo valor (ex.: pesquisa livre por nome OU NIF OU email). */
export interface AnyOfFilter<F extends string = string> {
  fields: F[];
  operator: FilterOperator;
  value: unknown;
}

export interface Sort<F extends string = string> {
  field: F;
  direction: SortDirection;
}

/** Quem pode ver o quê: tudo, a equipa de um gestor, ou só o que é de um utilizador. */
export type VisibilityScope = { kind: 'ALL' } | { kind: 'TEAM'; managerId: number } | { kind: 'SELF'; userId: number };

export interface Criteria<F extends string = string> {
  /** limita os resultados ao que o utilizador pode ver (aplicado pelo repositório do recurso) */
  scope?: VisibilityScope;
  filters: Filter<F>[];
  anyOf: AnyOfFilter<F>[];
  sorts: Sort<F>[];
  page: number;
  perPage: number;
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

export class CriteriaBuilder<F extends string> {
  private readonly filters: Filter<F>[] = [];
  private readonly anyOfs: AnyOfFilter<F>[] = [];
  private sorts: Sort<F>[] = [];
  private page = 1;
  private perPage = 10;
  private scope?: VisibilityScope;

  /** O que o utilizador pode ver. Obrigatório nas listagens de processos, facturas, negociações e contactos. */
  visibleTo(scope: VisibilityScope | undefined): this {
    this.scope = scope;
    return this;
  }

  add(field: F, value: unknown, operator: FilterOperator = FilterOperator.EQUAL): this {
    if (!isEmpty(value)) this.filters.push({ field, operator, value: typeof value === 'string' ? value.trim() : value });
    return this;
  }

  /** `campo1 op v OR campo2 op v …` — usado para a pesquisa livre `search`. */
  anyOf(fields: F[], value: unknown, operator: FilterOperator = FilterOperator.CONTAINS): this {
    if (!isEmpty(value) && fields.length) this.anyOfs.push({ fields, operator, value: typeof value === 'string' ? value.trim() : value });
    return this;
  }

  /**
   * Ordenação a partir de `sort=campo:asc,outro:desc`. Campos fora de `allowed`
   * são rejeitados pelo DTO; aqui garantimos uma ordenação por omissão estável.
   */
  orderBy(sort: Array<Sort<F>> | undefined, fallback: Sort<F>): this {
    this.sorts = sort?.length ? sort : [fallback];
    return this;
  }

  paginate(page = 1, perPage = 10): this {
    this.page = Math.max(1, page);
    this.perPage = Math.min(100, Math.max(1, perPage));
    return this;
  }

  build(): Criteria<F> {
    return { scope: this.scope, filters: [...this.filters], anyOf: [...this.anyOfs], sorts: [...this.sorts], page: this.page, perPage: this.perPage };
  }
}

export const Criteria = {
  for: <F extends string>() => new CriteriaBuilder<F>(),
};
