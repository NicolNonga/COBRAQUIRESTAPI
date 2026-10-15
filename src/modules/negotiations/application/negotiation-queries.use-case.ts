import { Injectable } from '@nestjs/common';
import { Criteria, FilterOperator, Sort, VisibilityScope } from '@/shared/domain/criteria';
import { NotFoundError } from '@/shared/domain/errors';
import { NegotiationField, NegotiationQueries } from '../domain/negotiation.repository';

export interface NegotiationSearch {
  page: number;
  perPage: number;
  search?: string;
  sort?: Sort<NegotiationField>[];
  statuses?: string[];
  debtorId?: number;
  createdById?: number;
  isInstallment?: boolean;
  minTotal?: string;
  maxTotal?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  scope: VisibilityScope;
}

@Injectable()
export class NegotiationQueriesUseCase {
  constructor(private readonly q: NegotiationQueries) {}

  list(f: NegotiationSearch) {
    return this.q.search(
      Criteria.for<NegotiationField>()
        .visibleTo(f.scope)
        .add('status', f.statuses, FilterOperator.IN)
        .add('debtorId', f.debtorId)
        .add('createdById', f.createdById)
        .add('isInstallment', f.isInstallment)
        .add('totalAmount', f.minTotal, FilterOperator.GREATER_OR_EQUAL)
        .add('totalAmount', f.maxTotal, FilterOperator.LESS_OR_EQUAL)
        .add('effectiveDate', f.effectiveFrom, FilterOperator.GREATER_OR_EQUAL)
        .add('effectiveDate', f.effectiveTo, FilterOperator.LESS_OR_EQUAL)
        .anyOf(['debtorName', 'debtorNif'], f.search)
        .orderBy(f.sort, { field: 'createdAt', direction: 'DESC' })
        .paginate(f.page, f.perPage)
        .build(),
    );
  }

  invoices(id: number, page: number, perPage: number, state?: string) {
    return this.q.invoicesOf(id, page, perPage, state);
  }

  async byId(id: number) {
    const n = await this.q.findDetailed(id);
    if (!n) throw new NotFoundError(`Negociação com id ${id} não encontrada`);
    return n;
  }
}
