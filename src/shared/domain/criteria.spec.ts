import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { Criteria, FilterOperator } from './criteria';

type F = 'state' | 'amount' | 'dueDate' | 'name' | 'ref' | 'closedAt';
const compiler = new CriteriaCompiler<F>({
  state: { column: 's.code', type: 'enum' },
  amount: { column: 'i.amount', type: 'decimal' },
  dueDate: { column: 'i.due_date', type: 'date' },
  name: { column: 'd.name', searchable: true },
  ref: { column: 'i.reference_number' },
  closedAt: { column: 'p.closed_at', type: 'date' },
});

describe('Criteria + CriteriaCompiler', () => {
  it('ignora filtros vazios e gera SQL parametrizado', () => {
    const c = compiler.compile(
      Criteria.for<F>()
        .add('state', ['OVERDUE'], FilterOperator.IN)
        .add('amount', '100', FilterOperator.GREATER_OR_EQUAL)
        .add('amount', undefined, FilterOperator.LESS_OR_EQUAL)
        .add('dueDate', '', FilterOperator.LESS_OR_EQUAL)
        .orderBy(undefined, { field: 'dueDate', direction: 'ASC' })
        .paginate(2, 20)
        .build(),
    );
    expect(c.where).toBe('s.code = ANY(CAST($1 AS text[])) AND i.amount >= CAST($2 AS numeric)');
    expect(c.params).toEqual([['OVERDUE'], '100']);
    expect(c.orderBy).toBe('i.due_date ASC NULLS LAST');
    expect([c.limit, c.offset]).toEqual([20, 20]);
  });

  it('pesquisa OR com escape de LIKE e sem acentos', () => {
    const c = compiler.compile(Criteria.for<F>().anyOf(['name', 'ref'], '50%_x').orderBy(undefined, { field: 'dueDate', direction: 'DESC' }).build());
    expect(c.where).toBe('(f_unaccent(d.name) ILIKE f_unaccent(CAST($1 AS text)) OR i.reference_number::text ILIKE CAST($2 AS text))');
    expect(c.params).toEqual(['%50\\%\\_x%', '%50\\%\\_x%']);
  });

  it('valores do cliente nunca entram no SQL', () => {
    const evil = "x'; DROP TABLE invoices;--";
    const c = compiler.compile(Criteria.for<F>().add('ref', evil, FilterOperator.EQUAL).orderBy(undefined, { field: 'dueDate', direction: 'ASC' }).build());
    expect(c.where).not.toContain('DROP');
    expect(c.params).toEqual([evil]);
  });

  it('IS_NULL e numeração a partir de um índice inicial', () => {
    const c = compiler.compile(Criteria.for<F>().add('closedAt', true, FilterOperator.IS_NULL).add('amount', '1').orderBy(undefined, { field: 'dueDate', direction: 'ASC' }).build(), 3);
    expect(c.where).toBe('p.closed_at IS NULL AND i.amount = CAST($3 AS numeric)');
  });

  it('rejeita campos fora da whitelist', () => {
    const bad = { filters: [{ field: 'password' as F, operator: FilterOperator.EQUAL, value: 1 }], anyOf: [], sorts: [], page: 1, perPage: 10 };
    expect(() => compiler.compile(bad)).toThrow(/não permitido/);
  });
});
