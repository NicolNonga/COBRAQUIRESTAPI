import { Injectable } from '@nestjs/common';
import { Criteria, FilterOperator, Sort, VisibilityScope } from '@/shared/domain/criteria';
import { ContactField, ContactRepository } from '../domain/process.repository';
import { ContactStatus } from '../infrastructure/process.orm-entities';

export interface ContactHistoryQuery {
  processId?: number;
  search?: string;
  userId?: number;
  contactTypeId?: number;
  statuses?: ContactStatus[];
  from?: string;
  to?: string;
  page: number;
  perPage: number;
  sort?: Sort<ContactField>[];
  scope: VisibilityScope;
}

/** Histórico de contactos (por processo ou por agente), do mais recente para o mais antigo. */
@Injectable()
export class ContactHistoryUseCase {
  constructor(private readonly contacts: ContactRepository) {}

  execute(q: ContactHistoryQuery) {
    return this.contacts.search(
      Criteria.for<ContactField>()
        .visibleTo(q.scope)
        .add('processId', q.processId)
        .add('userId', q.userId)
        .add('contactTypeId', q.contactTypeId)
        .add('status', q.statuses, FilterOperator.IN)
        .add('contactedAt', q.from, FilterOperator.GREATER_OR_EQUAL)
        .add('contactedAt', q.to, FilterOperator.LESS_OR_EQUAL)
        .add('notes', q.search, FilterOperator.CONTAINS)
        .orderBy(q.sort, { field: 'contactedAt', direction: 'DESC' })
        .paginate(q.page, q.perPage)
        .build(),
    );
  }
}
