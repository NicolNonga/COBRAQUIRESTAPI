import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { ConflictError } from '@/shared/domain/errors';
import { buildPage, offsetOf, Page, PageRequest } from '@/shared/domain/pagination';
import { CatalogItem, CatalogKind, CatalogReader, ContactTypeWriter } from '../domain/catalog-reader.port';
import {
  CategoryOrmEntity,
  ContactTypeOrmEntity,
  CurrencyOrmEntity,
  DebtorTypeOrmEntity,
  InvoiceStateOrmEntity,
  ProcessStateOrmEntity,
} from './catalog.orm-entities';

const ENTITIES: Record<CatalogKind, { target: EntityTarget<ObjectLiteral>; hasActive: boolean }> = {
  categories: { target: CategoryOrmEntity, hasActive: true },
  currencies: { target: CurrencyOrmEntity, hasActive: true },
  debtorTypes: { target: DebtorTypeOrmEntity, hasActive: false },
  contactTypes: { target: ContactTypeOrmEntity, hasActive: false },
  invoiceStates: { target: InvoiceStateOrmEntity, hasActive: true },
  processStates: { target: ProcessStateOrmEntity, hasActive: true },
};

@Injectable()
export class TypeOrmCatalogRepository extends BaseTypeOrmRepository implements CatalogReader, ContactTypeWriter {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async listActive(kind: CatalogKind): Promise<CatalogItem[]> {
    const { target, hasActive } = ENTITIES[kind];
    return (await this.repo(target).find({
      where: hasActive ? { isActive: true } : {},
      order: { name: 'ASC' },
    })) as CatalogItem[];
  }

  async paginate(kind: CatalogKind, req: PageRequest): Promise<Page<CatalogItem>> {
    const [rows, total] = await this.repo(ENTITIES[kind].target).findAndCount({
      order: { id: 'DESC' },
      skip: offsetOf(req),
      take: req.perPage,
    });
    return buildPage(rows as CatalogItem[], total, req);
  }

  async create(data: { name: string; description?: string | null }): Promise<{ id: number }> {
    try {
      const r = await this.repo(ContactTypeOrmEntity).insert({ name: data.name.trim(), description: data.description ?? null });
      return { id: r.identifiers[0].id };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError('Já existe um tipo de contacto com este nome');
      throw e;
    }
  }
}
