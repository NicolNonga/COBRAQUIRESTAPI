import { Injectable } from '@nestjs/common';
import { PageRequest } from '@/shared/domain/pagination';
import { ProcessStateCode } from '@/modules/catalogs/domain/state-catalog.port';
import { Criteria, FilterOperator, Sort, VisibilityScope } from '@/shared/domain/criteria';
import { ProcessField, ProcessQueries } from '../domain/process.repository';

export interface ProcessSearch {
  page: number;
  perPage: number;
  search?: string;
  sort?: Sort<ProcessField>[];
  states?: ProcessStateCode[];
  debtorId?: number;
  assignedUserId?: number;
  unassigned?: boolean;
  open?: boolean;
  createdFrom?: string;
  createdTo?: string;
  noContactSince?: string;
  lastContactStatuses?: string[];
  minContacts?: number;
  maxContacts?: number;
  /** o que o utilizador pode ver (obrigatório: uma listagem sem âmbito mostraria tudo) */
  scope: VisibilityScope;
}

@Injectable()
export class ProcessQueriesUseCase {
  constructor(private readonly q: ProcessQueries) {}
  list(f: ProcessSearch) {
    return this.q.search(
      Criteria.for<ProcessField>()
        .visibleTo(f.scope)
        .add('state', f.states, FilterOperator.IN)
        .add('debtorId', f.debtorId)
        .add('assignedUserId', f.assignedUserId)
        .add('assignedUserId', f.unassigned === undefined ? undefined : f.unassigned, FilterOperator.IS_NULL)
        .add('closedAt', f.open, FilterOperator.IS_NULL) // open=true → closed_at IS NULL
        .add('createdAt', f.createdFrom, FilterOperator.GREATER_OR_EQUAL)
        .add('createdAt', f.createdTo, FilterOperator.LESS_OR_EQUAL)
        .add('lastContactAt', f.noContactSince, FilterOperator.LESS) // inclui nunca contactados
        .add('lastContactStatus', f.lastContactStatuses, FilterOperator.IN)
        .add('contactsCount', f.minContacts, FilterOperator.GREATER_OR_EQUAL)
        .add('contactsCount', f.maxContacts, FilterOperator.LESS_OR_EQUAL)
        .anyOf(['debtorName', 'debtorNif'], f.search)
        .orderBy(f.sort, { field: 'createdAt', direction: 'DESC' })
        .paginate(f.page, f.perPage)
        .build(),
    );
  }
  assignedTo(userId: number, req: PageRequest) {
    return this.q.paginateAssignedTo(userId, req);
  }
  invoicesOf(processId: number, req: PageRequest) {
    return this.q.paginateInvoicesOf(processId, req);
  }
}
