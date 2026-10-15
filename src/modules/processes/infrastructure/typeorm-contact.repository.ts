import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { applyCriteria } from '@/infrastructure/database/criteria/query-builder.adapter';
import { processVisibleSql, scopeValue } from '@/infrastructure/database/visibility.sql';
import { Criteria } from '@/shared/domain/criteria';
import { buildPage, Page } from '@/shared/domain/pagination';
import { ContactField, ContactRepository, NewContact } from '../domain/process.repository';
import { ContactOrmEntity, ContactStatus } from './process.orm-entities';

const CONTACT_FIELDS = new CriteriaCompiler<ContactField>({
  processId: { column: 'c.process_id', type: 'number' },
  userId: { column: 'c.user_id', type: 'number' },
  contactTypeId: { column: 'c.contact_type_id', type: 'number' },
  status: { column: 'c.status', type: 'enum' },
  contactedAt: { column: 'c.contacted_at', type: 'date' },
  notes: { column: 'c.notes', searchable: true },
});

@Injectable()
export class TypeOrmContactRepository extends BaseTypeOrmRepository implements ContactRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async create(data: NewContact): Promise<number> {
    const r = await this.repo(ContactOrmEntity).insert({ ...data, contactDate: data.contactedAt.toISOString().slice(0, 10) });
    return r.identifiers[0].id;
  }

  /**
   * Um único UPDATE (o lock de linha serializa contactos simultâneos no mesmo processo):
   *  - contador sempre incrementado;
   *  - último estado só muda se este contacto for o mais recente — registar hoje um contacto
   *    de há 3 dias não sobrescreve o resultado mais actual.
   */
  async touchProcessSummary(processId: number, contactedAt: Date, status: ContactStatus): Promise<void> {
    await this.manager.query(
      `UPDATE processes SET
         last_contact_status = CASE WHEN last_contact_at IS NULL OR $2 >= last_contact_at THEN $3 ELSE last_contact_status END,
         last_contact_at     = GREATEST(last_contact_at, $2),
         contacts_count      = contacts_count + 1,
         updated_at          = now()
       WHERE id = $1`,
      [processId, contactedAt, status],
    );
  }

  /** usa ix_contacts_process_contacted / ix_contacts_user_contacted */
  async search(criteria: Criteria<ContactField>): Promise<Page<ContactOrmEntity>> {
    const qb = this.repo(ContactOrmEntity)
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.contactType', 'contactType')
      .leftJoin('c.user', 'agent')
      .addSelect(['agent.id', 'agent.fullName', 'agent.email']);
    if (criteria.scope && criteria.scope.kind !== 'ALL') {
      qb.andWhere(processVisibleSql('c.process_id', criteria.scope, ':visUser'), { visUser: scopeValue(criteria.scope) });
    }
    const [rows, total] = await applyCriteria(qb, CONTACT_FIELDS, criteria, 'c.id').getManyAndCount();
    return buildPage(rows, total, { page: criteria.page, perPage: criteria.perPage });
  }
}
