import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { auditDiff } from '@/shared/application/audit-diff';
import { NotFoundError } from '@/shared/domain/errors';
import { COST_CATEGORY_LABEL, CostCategory } from '../domain/kpi-formulas';

export interface CostInput {
  costDate: string;
  category: CostCategory;
  description: string;
  amount: string;
  organizationId?: number | null;
}

const SELECT = `
  SELECT c.id, c.cost_date::text AS "costDate", c.category, c.description, c.amount::text AS amount,
         c.organization_id AS "organizationId", o.name AS "organizationName",
         c.created_by_id AS "createdById", coalesce(u.full_name, u.email) AS "createdByName", c.created_at AS "createdAt"
    FROM collection_costs c
    LEFT JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN users u ON u.id = c.created_by_id`;

/** Custos da operação de cobrança (base do KPI "custo por cobrança"). Cada alteração fica na auditoria. */
@Injectable()
export class CollectionCostsService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  async list(q: { page: number; perPage: number; from?: string; to?: string; category?: string; organizationId?: number; search?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.from) where.push(`c.cost_date >= ${p(q.from)}::date`);
    if (q.to) where.push(`c.cost_date <= ${p(q.to)}::date`);
    if (q.category) where.push(`c.category = ${p(q.category)}`);
    if (q.organizationId) where.push(`c.organization_id = ${p(q.organizationId)}`);
    if (q.search) where.push(`c.description ILIKE ${p(`%${q.search.trim()}%`)}`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.ds.query(
      `${SELECT.replace('FROM collection_costs c', ', count(*) OVER () AS "_total", sum(c.amount) OVER ()::numeric(18,2)::text AS "_sum" FROM collection_costs c')}
       ${w} ORDER BY c.cost_date DESC, c.id DESC LIMIT ${p(q.perPage)} OFFSET ${p((q.page - 1) * q.perPage)}`,
      params,
    );
    const byCategory: Array<{ category: string; amount: string }> = await this.ds.query(
      `SELECT c.category, sum(c.amount)::numeric(18,2)::text AS amount FROM collection_costs c ${w} GROUP BY c.category ORDER BY sum(c.amount) DESC`,
      params.slice(0, params.length - 2),
    );
    const total = rows.length ? Number(rows[0]._total) : 0;
    return {
      meta: { total, perPage: q.perPage, currentPage: q.page, lastPage: Math.max(1, Math.ceil(total / q.perPage)), firstPage: 1 },
      summary: {
        amount: rows.length ? rows[0]._sum : byCategory.reduce((s, c) => s + Number(c.amount), 0).toFixed(2),
        byCategory: byCategory.map((c) => ({ ...c, label: COST_CATEGORY_LABEL[c.category as CostCategory] ?? c.category })),
      },
      data: rows.map(({ _total, _sum, ...r }: Record<string, unknown>) => r),
    };
  }

  private async get(id: number) {
    const [r] = await this.ds.query(`${SELECT} WHERE c.id = $1`, [id]);
    if (!r) throw new NotFoundError('Custo não encontrado');
    return r as Record<string, unknown>;
  }

  async create(input: CostInput, userId: number) {
    const id = await this.uow.run(async () => {
      const [r] = await this.ds.query(
        `INSERT INTO collection_costs (cost_date, category, description, amount, organization_id, created_by_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.costDate, input.category, input.description.trim(), input.amount, input.organizationId ?? null, userId],
      );
      await this.audit.record({ action: 'COLLECTION_COST_CREATED', entity: 'collection_cost', entityId: r.id, payload: { ...input, categoryLabel: COST_CATEGORY_LABEL[input.category] } });
      return r.id as number;
    });
    return this.get(id);
  }

  async update(id: number, input: CostInput) {
    const before = await this.get(id);
    await this.uow.run(async () => {
      await this.ds.query(
        `UPDATE collection_costs SET cost_date = $2, category = $3, description = $4, amount = $5, organization_id = $6, updated_at = now() WHERE id = $1`,
        [id, input.costDate, input.category, input.description.trim(), input.amount, input.organizationId ?? null],
      );
      const after = { costDate: input.costDate, category: input.category, description: input.description.trim(), amount: Number(input.amount).toFixed(2), organizationId: input.organizationId ?? null };
      const prev = { costDate: before.costDate, category: before.category, description: before.description, amount: before.amount, organizationId: before.organizationId ?? null };
      await this.audit.record({ action: 'COLLECTION_COST_UPDATED', entity: 'collection_cost', entityId: id, payload: { ...auditDiff(prev, after) } });
    });
    return this.get(id);
  }

  async remove(id: number) {
    const before = await this.get(id);
    await this.uow.run(async () => {
      await this.ds.query('DELETE FROM collection_costs WHERE id = $1', [id]);
      await this.audit.record({ action: 'COLLECTION_COST_DELETED', entity: 'collection_cost', entityId: id, payload: { before } });
    });
  }
}
