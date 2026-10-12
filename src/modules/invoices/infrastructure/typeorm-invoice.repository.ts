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
import { NewInvoice, overdueDays } from '../domain/invoice';
import { EditableInvoice, Invoice, InvoiceChanges, InvoiceField, InvoicePdfCandidate, InvoiceQueries, InvoiceRepository } from '../domain/invoice.repository';
import { InvoiceOrmEntity } from './invoice.orm-entity';

/** Whitelist campo → coluna SQL. Só estes campos podem ser filtrados/ordenados. */
const INVOICE_FIELDS = new CriteriaCompiler<InvoiceField>({
  state: { column: 'invoiceState.code', type: 'enum' },
  debtorId: { column: 'i.debtor_id', type: 'number' },
  currencyId: { column: 'i.currency_id', type: 'number' },
  amount: { column: 'i.amount', type: 'decimal' },
  dueDate: { column: 'i.due_date', type: 'date' },
  issueDate: { column: 'i.issue_date', type: 'date' },
  inProcess: { column: 'i.in_process', type: 'boolean' },
  reference: { column: 'i.reference_number' },
  debtorName: { column: 'debtor.name', searchable: true },
  debtorNif: { column: 'debtor.nif' },
  createdAt: { column: 'i.created_at', type: 'date' },
});

@Injectable()
export class TypeOrmInvoiceRepository extends BaseTypeOrmRepository implements InvoiceRepository, InvoiceQueries {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async create(data: NewInvoice): Promise<Invoice> {
    try {
      return await this.repo(InvoiceOrmEntity).save(this.repo(InvoiceOrmEntity).create(data));
    } catch (e) {
      if (isUniqueViolation(e, 'ux_invoices_reference_number')) throw new ConflictError('Número da factura já existe');
      throw e;
    }
  }

  async bulkCreate(rows: NewInvoice[]): Promise<number> {
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const r = await this.repo(InvoiceOrmEntity)
        .createQueryBuilder()
        .insert()
        .values(rows.slice(i, i + 500))
        .orIgnore() // referência duplicada concorrente → ignorada, não rebenta o lote
        .returning(['id'])
        .execute();
      n += r.raw.length;
    }
    return n;
  }

  async existingReferences(refs: string[]): Promise<Set<string>> {
    if (!refs.length) return new Set();
    const rows: Array<{ r: string }> = await this.manager.query(
      'SELECT lower(reference_number) AS r FROM invoices WHERE lower(reference_number) = ANY($1)',
      [refs.map((r) => r.toLowerCase())],
    );
    return new Set(rows.map((x) => x.r));
  }

  async markOverdue(overdueStateId: number, openStateIds: number[], today: string): Promise<number> {
    // O original mudava para "vencida" QUALQUER factura com due_date < hoje (incluindo pagas e canceladas!).
    const [, affected] = await this.manager.query(
      `UPDATE invoices SET invoice_state_id = $1, updated_at = now()
        WHERE due_date < $2::date AND invoice_state_id = ANY($3)`,
      [overdueStateId, today, openStateIds],
    );
    return affected;
  }

  pdfCandidates(): Promise<InvoicePdfCandidate[]> {
    // projecção mínima + índice parcial ix_invoices_without_document
    return this.manager.query(
      `SELECT i.id, i.reference_number AS "referenceNumber", d.name AS "debtorName", d.nif AS "debtorNif"
         FROM invoices i JOIN debtors d ON d.id = i.debtor_id
        WHERE i.document_path IS NULL`,
    );
  }

  async attachDocumentIfEmpty(id: number, path: string): Promise<boolean> {
    const [, affected] = await this.manager.query(
      'UPDATE invoices SET document_path = $2, updated_at = now() WHERE id = $1 AND document_path IS NULL',
      [id, path],
    );
    return affected > 0;
  }

  async findForUpdate(id: number): Promise<EditableInvoice | null> {
    const rows = await this.manager.query(
      `SELECT i.id, i.reference_number AS "referenceNumber", i.amount::text AS amount, to_char(i.issue_date, 'YYYY-MM-DD') AS "issueDate",
              i.time_limit_days AS "timeLimitDays", to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate", i.debtor_id AS "debtorId",
              i.currency_id AS "currencyId", i.in_process AS "inProcess", s.code AS "stateCode"
         FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id
        WHERE i.id = $1 FOR UPDATE OF i`,
      [id],
    );
    return rows[0] ?? null;
  }

  async update(id: number, data: InvoiceChanges): Promise<void> {
    try {
      await this.repo(InvoiceOrmEntity).update({ id }, data);
    } catch (e) {
      if (isUniqueViolation(e, 'ux_invoices_reference_number')) throw new ConflictError('Já existe outra factura com este número');
      throw e;
    }
  }

  async processOf(id: number): Promise<{ processId: number; activeNegotiationId: number | null } | null> {
    const rows = await this.manager.query(
      `SELECT pi.process_id AS "processId",
              (SELECT np.negotiation_id FROM negotiation_processes np WHERE np.process_id = pi.process_id AND np.is_active LIMIT 1) AS "activeNegotiationId"
         FROM process_invoices pi WHERE pi.invoice_id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async detachFromProcess(id: number): Promise<void> {
    await this.manager.query('DELETE FROM process_invoices WHERE invoice_id = $1', [id]);
    await this.manager.query('UPDATE invoices SET in_process = false, updated_at = now() WHERE id = $1', [id]);
  }

  async documentOf(id: number): Promise<{ referenceNumber: string; documentPath: string | null } | null> {
    const rows = await this.manager.query(
      'SELECT reference_number AS "referenceNumber", document_path AS "documentPath" FROM invoices WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async search(criteria: Criteria<InvoiceField>): Promise<Page<Invoice & { overdueDays: number }>> {
    // JOINs só N:1 → 1 query de dados + 1 count, sem N+1 e sem multiplicação de linhas
    const qb = this.repo(InvoiceOrmEntity)
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.debtor', 'debtor')
      .leftJoinAndSelect('i.currency', 'currency')
      .leftJoinAndSelect('i.invoiceState', 'invoiceState')
      .leftJoin('i.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.fullName', 'createdBy.email']);
    const [rows, total] = await applyCriteria(qb, INVOICE_FIELDS, criteria, 'i.id').getManyAndCount();
    const today = new Date().toISOString().slice(0, 10);
    return buildPage(
      rows.map((r) => Object.assign(r, { overdueDays: overdueDays(r.dueDate, today) })),
      total,
      { page: criteria.page, perPage: criteria.perPage },
    );
  }

}
