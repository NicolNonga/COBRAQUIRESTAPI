import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { ConflictError } from '@/shared/domain/errors';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { applyCriteria } from '@/infrastructure/database/criteria/query-builder.adapter';
import { Criteria } from '@/shared/domain/criteria';
import { buildPage, Page } from '@/shared/domain/pagination';
import { NewOrganization, Organization, OrganizationField, OrganizationRepository } from '../domain/organization.repository';

const ORG_FIELDS = new CriteriaCompiler<OrganizationField>({
  name: { column: 'o.name', searchable: true },
  email: { column: 'o.email' },
  phoneNumber: { column: 'o.phone_number' },
  isActive: { column: 'o.is_active', type: 'boolean' },
  createdAt: { column: 'o.created_at', type: 'date' },
});
import { OrganizationOrmEntity } from './organization.orm-entity';

const UNIQUE_MESSAGES: Record<string, string> = {
  ux_organizations_email: 'Já existe uma organização com este email',
  ux_organizations_name: 'Já existe uma organização com este nome',
  ux_organizations_phone_number: 'Já existe uma organização com este contacto',
};

@Injectable()
export class TypeOrmOrganizationRepository extends BaseTypeOrmRepository implements OrganizationRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async create(data: NewOrganization): Promise<Organization> {
    try {
      return await this.repo(OrganizationOrmEntity).save(this.repo(OrganizationOrmEntity).create(data));
    } catch (e) {
      // A unicidade é garantida pela BD (índices únicos), não por SELECT prévio → sem race condition.
      for (const [constraint, msg] of Object.entries(UNIQUE_MESSAGES)) if (isUniqueViolation(e, constraint)) throw new ConflictError(msg);
      throw e;
    }
  }

  async bulkInsertIgnoringDuplicates(rows: NewOrganization[]): Promise<number> {
    if (!rows.length) return 0;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const r = await this.repo(OrganizationOrmEntity)
        .createQueryBuilder()
        .insert()
        .values(rows.slice(i, i + 500))
        .orIgnore() // ON CONFLICT DO NOTHING
        .returning(['id'])
        .execute();
      inserted += r.raw.length;
    }
    return inserted;
  }

  findById(id: number): Promise<Organization | null> {
    return this.repo(OrganizationOrmEntity).findOne({ where: { id } });
  }

  async update(id: number, data: Partial<NewOrganization>): Promise<boolean> {
    try {
      return ((await this.repo(OrganizationOrmEntity).update({ id }, data)).affected ?? 0) > 0;
    } catch (e) {
      for (const [constraint, msg] of Object.entries(UNIQUE_MESSAGES)) if (isUniqueViolation(e, constraint)) throw new ConflictError(msg);
      throw e;
    }
  }

  async setActive(id: number, active: boolean): Promise<boolean> {
    return ((await this.repo(OrganizationOrmEntity).update({ id }, { isActive: active })).affected ?? 0) > 0;
  }

  async search(criteria: Criteria<OrganizationField>): Promise<Page<Organization>> {
    const qb = this.repo(OrganizationOrmEntity).createQueryBuilder('o');
    const [rows, total] = await applyCriteria(qb, ORG_FIELDS, criteria, 'o.id').getManyAndCount();
    return buildPage(rows, total, { page: criteria.page, perPage: criteria.perPage });
  }

  listActive(): Promise<Pick<Organization, 'id' | 'name'>[]> {
    return this.repo(OrganizationOrmEntity).find({ select: { id: true, name: true }, where: { isActive: true }, order: { name: 'ASC' } });
  }

  /** Uma única query para N nomes (substitui `LIKE %nome%` linha-a-linha do import). */
  async findIdsByNames(names: string[]): Promise<Map<string, number>> {
    const uniq = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
    if (!uniq.length) return new Map();
    const rows: Array<{ id: number; key: string }> = await this.manager.query(
      'SELECT id, lower(name) AS key FROM organizations WHERE lower(name) = ANY($1)',
      [uniq],
    );
    return new Map(rows.map((r) => [r.key, r.id]));
  }
}
