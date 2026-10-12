import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { Criteria } from '@/shared/domain/criteria';
import { ConflictError } from '@/shared/domain/errors';
import { buildPage, Page } from '@/shared/domain/pagination';
import { Dispute, DisputeField, DisputeListItem, DisputeOutcome, DisputeRegistry, DisputeRepository, InvoiceForDispute } from '../domain/invoice-dispute';

const FIELDS = new CriteriaCompiler<DisputeField>({
  status: { column: 'x.status', type: 'enum' },
  outcome: { column: 'x.outcome', type: 'enum' },
  invoiceId: { column: 'x.invoice_id', type: 'number' },
  debtorId: { column: 'i.debtor_id', type: 'number' },
  organizationId: { column: 'd.organization_id', type: 'number' },
  openedById: { column: 'x.opened_by_id', type: 'number' },
  openedAt: { column: 'x.opened_at', type: 'date' },
  resolvedAt: { column: 'x.resolved_at', type: 'date' },
  invoiceReference: { column: 'i.reference_number', searchable: true },
  debtorName: { column: 'd.name', searchable: true },
});

const COLUMNS = `
  x.id::text AS id, x.invoice_id AS "invoiceId", x.process_id AS "processId", x.reason, x.status, x.outcome,
  x.original_amount::text AS "originalAmount", x.adjusted_amount::text AS "adjustedAmount", x.resolution_notes AS "resolutionNotes",
  x.opened_by_id AS "openedById", x.opened_at AS "openedAt", x.resolved_by_id AS "resolvedById", x.resolved_at AS "resolvedAt", x.version,
  i.reference_number AS "invoiceReference", i.amount::text AS "invoiceAmount", to_char(i.due_date, 'YYYY-MM-DD') AS "invoiceDueDate",
  d.id AS "debtorId", d.name AS "debtorName", o.id AS "organizationId", o.name AS "organizationName", u.full_name AS "openedByName",
  (COALESCE(x.resolved_at, now())::date - x.opened_at::date) AS "daysOpen"`;
const FROM = `
  FROM invoice_disputes x
  JOIN invoices i ON i.id = x.invoice_id
  JOIN debtors d ON d.id = i.debtor_id
  JOIN organizations o ON o.id = d.organization_id
  LEFT JOIN users u ON u.id = x.opened_by_id`;

@Injectable()
export class TypeOrmDisputeRepository extends BaseTypeOrmRepository implements DisputeRepository, DisputeRegistry {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async lockInvoice(invoiceId: number): Promise<InvoiceForDispute | null> {
    const [r] = await this.manager.query(
      `SELECT i.id, i.amount::text AS amount, to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate", s.code AS "stateCode",
              i.in_process AS "inProcess", pi.process_id AS "processId",
              EXISTS (SELECT 1 FROM negotiation_processes np WHERE np.process_id = pi.process_id AND np.is_active) AS "processHasActiveNegotiation"
         FROM invoices i
         JOIN invoice_states s ON s.id = i.invoice_state_id
         LEFT JOIN process_invoices pi ON pi.invoice_id = i.id
        WHERE i.id = $1
        FOR UPDATE OF i`,
      [invoiceId],
    );
    return r ?? null;
  }

  async detachAndMarkDisputed(invoiceId: number, processId: number | null, disputeStateId: number): Promise<void> {
    if (processId) await this.manager.query('DELETE FROM process_invoices WHERE process_id = $1 AND invoice_id = $2', [processId, invoiceId]);
    await this.manager.query('UPDATE invoices SET in_process = false, invoice_state_id = $2, updated_at = now() WHERE id = $1', [invoiceId, disputeStateId]);
  }

  async insertOpen(rows: Array<{ invoiceId: number; processId: number | null; reason: string; originalAmount: string; openedById: number | null }>): Promise<string[]> {
    if (!rows.length) return [];
    try {
      const res: Array<{ id: string }> = await this.manager.query(
        `INSERT INTO invoice_disputes (invoice_id, process_id, reason, original_amount, opened_by_id)
         SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::numeric[], $5::int[])
         RETURNING id::text AS id`,
        [rows.map((r) => r.invoiceId), rows.map((r) => r.processId), rows.map((r) => r.reason), rows.map((r) => r.originalAmount), rows.map((r) => r.openedById)],
      );
      return res.map((r) => r.id);
    } catch (e) {
      if (isUniqueViolation(e, 'ux_invoice_disputes_open')) throw new ConflictError('Já existe uma disputa aberta para esta factura');
      throw e;
    }
  }

  /** porta pública para o módulo de processos (o valor original é lido da própria factura) */
  async recordOpened(items: Array<{ invoiceId: number; processId: number | null }>, reason: string, openedById: number | null): Promise<void> {
    if (!items.length) return;
    try {
      await this.manager.query(
        `INSERT INTO invoice_disputes (invoice_id, process_id, reason, original_amount, opened_by_id)
         SELECT x.invoice_id, x.process_id, $3, i.amount, $4
           FROM unnest($1::int[], $2::int[]) AS x(invoice_id, process_id) JOIN invoices i ON i.id = x.invoice_id`,
        [items.map((i) => i.invoiceId), items.map((i) => i.processId), reason, openedById],
      );
    } catch (e) {
      if (isUniqueViolation(e, 'ux_invoice_disputes_open')) throw new ConflictError('Uma das facturas já tem uma disputa aberta');
      throw e;
    }
  }

  async findForUpdate(id: string): Promise<Dispute | null> {
    const [r] = await this.manager.query(
      `SELECT x.id::text AS id, x.invoice_id AS "invoiceId", x.process_id AS "processId", x.reason, x.status, x.outcome,
              x.original_amount::text AS "originalAmount", x.adjusted_amount::text AS "adjustedAmount", x.resolution_notes AS "resolutionNotes",
              x.opened_by_id AS "openedById", x.opened_at AS "openedAt", x.resolved_by_id AS "resolvedById", x.resolved_at AS "resolvedAt", x.version
         FROM invoice_disputes x WHERE x.id = $1 FOR UPDATE`,
      [id],
    );
    return r ?? null;
  }

  async markResolved(id: string, version: number, outcome: DisputeOutcome, adjustedAmount: string | null, notes: string, byUserId: number): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE invoice_disputes SET status = 'RESOLVED', outcome = $3, adjusted_amount = $4, resolution_notes = $5,
              resolved_by_id = $6, resolved_at = now(), version = version + 1
        WHERE id = $1 AND version = $2 AND status = 'OPEN'`,
      [id, version, outcome, adjustedAmount, notes, byUserId],
    );
    return n > 0;
  }

  async applyToInvoice(invoiceId: number, stateId: number, newAmount: string | null): Promise<void> {
    await this.manager.query(
      'UPDATE invoices SET invoice_state_id = $2, amount = COALESCE($3::numeric, amount), updated_at = now() WHERE id = $1',
      [invoiceId, stateId, newAmount],
    );
  }

  async search(criteria: Criteria<DisputeField>): Promise<Page<DisputeListItem>> {
    const c = FIELDS.compile(criteria);
    const rows = await this.manager.query(
      `SELECT ${COLUMNS} ${FROM} WHERE ${c.where} ORDER BY ${c.orderBy}, x.id DESC LIMIT $${c.params.length + 1} OFFSET $${c.params.length + 2}`,
      [...c.params, c.limit, c.offset],
    );
    const [{ total }] = await this.manager.query(`SELECT count(*)::int AS total ${FROM} WHERE ${c.where}`, c.params);
    return buildPage(rows, total, { page: criteria.page, perPage: criteria.perPage });
  }

  async findDetailed(id: string): Promise<DisputeListItem | null> {
    const [r] = await this.manager.query(`SELECT ${COLUMNS} ${FROM} WHERE x.id = $1`, [id]);
    return r ?? null;
  }
}
