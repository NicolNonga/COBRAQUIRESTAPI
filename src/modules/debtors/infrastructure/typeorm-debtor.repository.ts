import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { isUniqueViolation, pgError } from '@/infrastructure/database/pg-errors';
import { ConflictError } from '@/shared/domain/errors';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { applyCriteria } from '@/infrastructure/database/criteria/query-builder.adapter';
import { Criteria } from '@/shared/domain/criteria';
import { buildPage, Page } from '@/shared/domain/pagination';
import {
  ContactPersonData,
  Debtor,
  DebtorDashboard,
  DebtorData,
  DebtorDebtSummary,
  DebtorField,
  DebtorIdentityKeys,
  DebtorQueries,
  DebtorRepository,
} from '../domain/debtor.repository';
import { DebtorContactPersonOrmEntity, DebtorOrmEntity } from './debtor.orm-entities';

const UNIQUE_MSG: Record<string, string> = {
  ux_debtors_email: 'Já existe um devedor com este email',
  ux_debtors_nif: 'Já existe um devedor com este NIF',
  ux_debtors_phone_number: 'Já existe um devedor com este contacto',
  ux_debtors_name: 'Já existe um devedor com este nome',
};

const lowerSet = (rows: Array<{ v: string }>) => new Set(rows.map((r) => r.v));

const DEBTOR_FIELDS = new CriteriaCompiler<DebtorField>({
  name: { column: 'd.name', searchable: true },
  nif: { column: 'd.nif' },
  email: { column: 'd.email' },
  organizationId: { column: 'd.organization_id', type: 'number' },
  debtorTypeId: { column: 'd.debtor_type_id', type: 'number' },
  isActive: { column: 'd.is_active', type: 'boolean' },
  isCompany: { column: 'd.is_company', type: 'boolean' },
  createdAt: { column: 'd.created_at', type: 'date' },
  organizationName: { column: 'organization.name', searchable: true },
});

@Injectable()
export class TypeOrmDebtorRepository extends BaseTypeOrmRepository implements DebtorRepository, DebtorQueries {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  private translate(e: unknown): never {
    const c = pgError(e)?.constraint;
    if (isUniqueViolation(e) && c && UNIQUE_MSG[c]) throw new ConflictError(UNIQUE_MSG[c]);
    throw e;
  }

  async create(data: DebtorData, contact: ContactPersonData): Promise<Debtor> {
    try {
      const debtor = await this.repo(DebtorOrmEntity).save(this.repo(DebtorOrmEntity).create(data));
      await this.repo(DebtorContactPersonOrmEntity).insert({ ...contact, debtorId: debtor.id });
      return debtor;
    } catch (e) {
      this.translate(e);
    }
  }

  /** Import em lote: 2 INSERTs por bloco de 500 linhas, em vez de 2 por linha. */
  async bulkCreate(rows: Array<{ debtor: DebtorData; contact: ContactPersonData }>): Promise<number> {
    let count = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const ins = await this.repo(DebtorOrmEntity).createQueryBuilder().insert().values(chunk.map((r) => r.debtor)).returning(['id']).execute();
      const ids: number[] = ins.raw.map((r: { id: number }) => r.id);
      await this.repo(DebtorContactPersonOrmEntity).insert(chunk.map((r, idx) => ({ ...r.contact, debtorId: ids[idx] })));
      count += ids.length;
    }
    return count;
  }

  async update(id: number, data: Partial<DebtorData>, contact: ContactPersonData): Promise<boolean> {
    try {
      const r = await this.repo(DebtorOrmEntity).update({ id }, data);
      if (!r.affected) return false;
      // upsert do contacto (1:1 garantido por ux_debtor_contact_persons_debtor)
      await this.manager.query(
        `INSERT INTO debtor_contact_persons (debtor_id, name, email, contact, position)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (debtor_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email,
           contact = EXCLUDED.contact, position = EXCLUDED.position, updated_at = now()`,
        [id, contact.name, contact.email, contact.contact, contact.position],
      );
      return true;
    } catch (e) {
      this.translate(e);
    }
  }

  findById(id: number): Promise<Debtor | null> {
    return this.repo(DebtorOrmEntity).findOne({ where: { id }, relations: { contactPerson: true } });
  }

  async setActive(id: number, active: boolean): Promise<boolean> {
    return ((await this.repo(DebtorOrmEntity).update({ id }, { isActive: active })).affected ?? 0) > 0;
  }

  async existingIdentityKeys(k: DebtorIdentityKeys) {
    const q = (col: string, vals: string[]) =>
      vals.length
        ? this.manager.query(`SELECT lower(${col}) AS v FROM debtors WHERE lower(${col}) = ANY($1)`, [vals.map((v) => v.toLowerCase())])
        : Promise.resolve([]);
    const [names, emails, phones, nifs] = await Promise.all([q('name', k.names), q('email', k.emails), q('phone_number', k.phones), q('nif', k.nifs)]);
    return { names: lowerSet(names), emails: lowerSet(emails), phones: lowerSet(phones), nifs: lowerSet(nifs) };
  }

  async findIdsByNameAndNif(pairs: Array<{ name: string; nif: string }>): Promise<Map<string, number>> {
    if (!pairs.length) return new Map();
    const rows: Array<{ id: number; key: string }> = await this.manager.query(
      `SELECT d.id, lower(d.name) || '|' || lower(d.nif) AS key
         FROM debtors d
         JOIN unnest($1::text[], $2::text[]) AS p(name, nif)
           ON lower(d.name) = lower(p.name) AND lower(d.nif) = lower(p.nif)`,
      [pairs.map((p) => p.name), pairs.map((p) => p.nif)],
    );
    return new Map(rows.map((r) => [r.key, r.id]));
  }

  // ------------- Queries -------------

  /** Relações 1:1 / N:1 via LEFT JOIN — sem multiplicação de linhas, paginação segura. */
  async search(criteria: Criteria<DebtorField>): Promise<Page<Debtor>> {
    const qb = this.repo(DebtorOrmEntity)
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.organization', 'organization')
      .leftJoinAndSelect('d.contactPerson', 'contactPerson')
      .leftJoinAndSelect('d.debtorType', 'debtorType');
    const [rows, total] = await applyCriteria(qb, DEBTOR_FIELDS, criteria, 'd.id').getManyAndCount();
    return buildPage(rows, total, { page: criteria.page, perPage: criteria.perPage });
  }

  activeDropdown() {
    return this.repo(DebtorOrmEntity).find({ select: { id: true, name: true }, where: { isActive: true }, order: { name: 'ASC' } });
  }

  withoutWalletDropdown(): Promise<Array<{ id: number; name: string }>> {
    // NOT EXISTS (anti-join) — usa ux_user_wallets_debtor; evita o NOT IN com subquery do original
    return this.manager.query(
      `SELECT d.id, d.name FROM debtors d
        WHERE d.is_active AND NOT EXISTS (SELECT 1 FROM user_wallets w WHERE w.debtor_id = d.id)
        ORDER BY d.created_at DESC`,
    );
  }

  /** 4 contagens numa ÚNICA passagem (o original fazia 4 queries). */
  async dashboard(): Promise<DebtorDashboard> {
    const [r] = await this.manager.query(
      `SELECT count(*)::int                                     AS "totalDebtors",
              count(*) FILTER (WHERE d.is_active)::int           AS "totalDebtorsActive",
              count(*) FILTER (WHERE t.is_company)::int          AS "totalDebtorCompany",
              count(*) FILTER (WHERE NOT t.is_company)::int      AS "totalDebtorParticular"
         FROM debtors d JOIN debtor_types t ON t.id = d.debtor_type_id`,
    );
    return r;
  }

  /**
   * Dívida de um devedor numa única passagem pelas facturas:
   * em aberto = tudo o que não está liquidado nem anulado (usa ix_invoices_debtor).
   */
  async debtSummary(debtorId: number): Promise<DebtorDebtSummary> {
    const [r] = await this.manager.query(
      `SELECT coalesce(sum(i.amount) FILTER (WHERE s.code NOT IN ('PAID', 'CANCELLED')), 0)::numeric(18,2)::text AS "totalDebt",
              coalesce(sum(i.amount) FILTER (WHERE s.code = 'OVERDUE'), 0)::numeric(18,2)::text                  AS "overdueDebt",
              coalesce(sum(i.amount) FILTER (WHERE s.code = 'PAID'), 0)::numeric(18,2)::text                     AS "paidAmount",
              count(*) FILTER (WHERE s.code NOT IN ('PAID', 'CANCELLED'))::int                                   AS "openInvoices",
              count(*) FILTER (WHERE s.code = 'OVERDUE')::int                                                    AS "overdueInvoices"
         FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id
        WHERE i.debtor_id = $1`,
      [debtorId],
    );
    return r;
  }
}
