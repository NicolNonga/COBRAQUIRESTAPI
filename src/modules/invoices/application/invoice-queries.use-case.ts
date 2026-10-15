import { Injectable } from '@nestjs/common';
import { InvoiceStateCode } from '@/modules/catalogs/domain/state-catalog.port';
import { Criteria, FilterOperator, Sort, VisibilityScope } from '@/shared/domain/criteria';
import { InvoiceField, InvoiceQueries } from '../domain/invoice.repository';

export interface InvoiceSearch {
  page: number;
  perPage: number;
  search?: string;
  sort?: Sort<InvoiceField>[];
  states?: InvoiceStateCode[];
  debtorId?: number;
  currencyId?: number;
  minAmount?: string;
  maxAmount?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  issueDateFrom?: string;
  issueDateTo?: string;
  inProcess?: boolean;
  scope: VisibilityScope;
}

@Injectable()
export class InvoiceQueriesUseCase {
  constructor(private readonly q: InvoiceQueries) {}

  list(f: InvoiceSearch) {
    const criteria = Criteria.for<InvoiceField>()
      .visibleTo(f.scope)
      .add('state', f.states, FilterOperator.IN)
      .add('debtorId', f.debtorId, FilterOperator.EQUAL)
      .add('currencyId', f.currencyId, FilterOperator.EQUAL)
      .add('amount', f.minAmount, FilterOperator.GREATER_OR_EQUAL)
      .add('amount', f.maxAmount, FilterOperator.LESS_OR_EQUAL)
      .add('dueDate', f.dueDateFrom, FilterOperator.GREATER_OR_EQUAL)
      .add('dueDate', f.dueDateTo, FilterOperator.LESS_OR_EQUAL)
      .add('issueDate', f.issueDateFrom, FilterOperator.GREATER_OR_EQUAL)
      .add('issueDate', f.issueDateTo, FilterOperator.LESS_OR_EQUAL)
      .add('inProcess', f.inProcess, FilterOperator.EQUAL)
      .anyOf(['reference', 'debtorName', 'debtorNif'], f.search, FilterOperator.CONTAINS)
      .orderBy(f.sort, { field: 'createdAt', direction: 'DESC' })
      .paginate(f.page, f.perPage)
      .build();
    return this.q.search(criteria);
  }

  /** atalho mantido por compatibilidade: GET /invoices/overdue = list com estado OVERDUE */
  overdue(f: InvoiceSearch) {
    return this.list({ ...f, states: [InvoiceStateCode.OVERDUE] });
  }
}
