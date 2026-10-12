import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { applyCriteria } from '@/infrastructure/database/criteria/query-builder.adapter';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { Criteria } from '@/shared/domain/criteria';
import { BusinessRuleError, ConflictError } from '@/shared/domain/errors';
import { buildPage, Page } from '@/shared/domain/pagination';
import { Allocation, AllocationBucket } from '../domain/payment';
import {
  CompletionResult,
  ConfirmationSnapshot,
  DebtorCreditEntry,
  DebtorCreditRepository,
  LockedNegotiation,
  NewPayment,
  Payment,
  PaymentAllocationView,
  PaymentField,
  PaymentRepository,
  PaymentSettlementRepository,
  PaymentTarget,
} from '../domain/payment.repository';
import { PaymentOrmEntity } from './payment.orm-entities';

const PAYMENT_FIELDS = new CriteriaCompiler<PaymentField>({
  status: { column: 'p.status', type: 'enum' },
  receiver: { column: 'p.receiver', type: 'enum' },
  negotiationId: { column: 'p.negotiation_id', type: 'number' },
  installmentId: { column: 'p.installment_id', type: 'number' },
  debtorId: { column: 'p.debtor_id', type: 'number' },
  organizationId: { column: 'p.organization_id', type: 'number' },
  registeredById: { column: 'p.registered_by_id', type: 'number' },
  paymentMethodId: { column: 'p.payment_method_id', type: 'number' },
  currencyId: { column: 'p.currency_id', type: 'number' },
  paidOn: { column: 'p.paid_on', type: 'date' },
  amountBase: { column: 'p.amount_base', type: 'decimal' },
  createdAt: { column: 'p.created_at', type: 'date' },
  reference: { column: 'p.reference', searchable: true },
  debtorName: { column: '(SELECT d.name FROM debtors d WHERE d.id = p.debtor_id)', searchable: true },
  // gestor da carteira de quem registou → fila de confirmação do gestor
  registrantManagerId: { column: '(SELECT wa.manager_id FROM wallet_agents wa WHERE wa.agent_id = p.registered_by_id LIMIT 1)', type: 'number' },
});

type CreditStatementLine = DebtorCreditEntry & { id: string; createdAt: Date };

const SUM_ACTIVE_ALLOCATIONS = (where: string) =>
  `COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa WHERE ${where} AND pa.reversed_at IS NULL), 0)`;

@Injectable()
export class TypeOrmPaymentRepository extends BaseTypeOrmRepository implements PaymentRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async lockNegotiation(negotiationId: number): Promise<LockedNegotiation | null> {
    const [n] = await this.manager.query(
      'SELECT id, status, is_installment AS "isInstallment" FROM negotiations WHERE id = $1 FOR UPDATE',
      [negotiationId],
    );
    return n ?? null;
  }

  async lockTarget(negotiationId: number, installmentId: number | null): Promise<PaymentTarget | null> {
    const n = await this.lockNegotiation(negotiationId);
    if (!n) return null;
    let installmentStatus: string | null = null;
    if (installmentId) {
      const [i] = await this.manager.query(
        'SELECT status FROM negotiation_installments WHERE id = $1 AND negotiation_id = $2 FOR UPDATE',
        [installmentId, negotiationId],
      );
      if (!i) return null;
      installmentStatus = i.status;
    }
    const [d] = await this.manager.query(
      `SELECT d.id AS "debtorId", d.organization_id AS "organizationId"
         FROM negotiation_processes np JOIN processes pr ON pr.id = np.process_id JOIN debtors d ON d.id = pr.debtor_id
        WHERE np.negotiation_id = $1 ORDER BY np.id LIMIT 1`,
      [negotiationId],
    );
    if (!d) return null;
    return { ...n, installmentId, installmentStatus, debtorId: d.debtorId, organizationId: d.organizationId };
  }

  async create(p: NewPayment): Promise<string> {
    try {
      const r = await this.repo(PaymentOrmEntity).insert({ ...p, status: 'PENDING' });
      return String(r.identifiers[0].id);
    } catch (e) {
      if (isUniqueViolation(e, 'ux_payments_method_reference')) throw new ConflictError('Este comprovativo (meio + referência) já foi registado');
      throw e;
    }
  }

  findById(id: string): Promise<Payment | null> {
    return this.repo(PaymentOrmEntity).findOneBy({ id });
  }

  findForUpdate(id: string): Promise<Payment | null> {
    return this.repo(PaymentOrmEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  async markConfirmed(id: string, version: number, byUserId: number, s: ConfirmationSnapshot): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE payments SET status = 'CONFIRMED', confirmed_by_id = $3, confirmed_at = now(),
              commission_rate = $4, commission_amount = $5, credit_amount = $6, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'PENDING'`,
      [id, version, byUserId, s.commissionRate, s.commissionAmount, s.creditAmount],
    );
    return n > 0;
  }

  async markCancelled(id: string, version: number, byUserId: number, reason: string): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE payments SET status = 'CANCELLED', cancelled_by_id = $3, cancelled_at = now(), cancel_reason = $4,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'PENDING'`,
      [id, version, byUserId, reason],
    );
    return n > 0;
  }

  async markReversed(id: string, version: number, byUserId: number, reason: string): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE payments SET status = 'REVERSED', reversed_by_id = $3, reversed_at = now(), reverse_reason = $4,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'CONFIRMED'`,
      [id, version, byUserId, reason],
    );
    return n > 0;
  }

  /** 1 query + 1 count; relações por JOIN (sem N+1) */
  async search(criteria: Criteria<PaymentField>): Promise<Page<Payment>> {
    const qb = this.repo(PaymentOrmEntity)
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.paymentMethod', 'paymentMethod')
      .leftJoinAndSelect('p.currency', 'currency')
      .leftJoin('p.registeredBy', 'registeredBy')
      .addSelect(['registeredBy.id', 'registeredBy.fullName']);
    const [rows, total] = await applyCriteria(qb, PAYMENT_FIELDS, criteria, 'p.id').getManyAndCount();
    return buildPage(rows, total, { page: criteria.page, perPage: criteria.perPage });
  }

  allocationsOf(paymentId: string): Promise<PaymentAllocationView[]> {
    return this.manager.query(
      `SELECT pa.id::text AS id, pa.installment_id AS "installmentId", ni.installment_number AS "installmentNumber",
              pa.amount::text AS amount, to_char(pa.paid_on, 'YYYY-MM-DD') AS "paidOn", pa.reversed_at AS "reversedAt"
         FROM payment_allocations pa LEFT JOIN negotiation_installments ni ON ni.id = pa.installment_id
        WHERE pa.payment_id = $1 ORDER BY pa.id`,
      [paymentId],
    );
  }
}

@Injectable()
export class TypeOrmPaymentSettlementRepository extends BaseTypeOrmRepository implements PaymentSettlementRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  openBuckets(negotiationId: number, isInstallment: boolean, firstInstallmentId: number | null): Promise<AllocationBucket[]> {
    if (!isInstallment) {
      return this.manager.query(
        `SELECT NULL::int AS "installmentId",
                (n.final_amount - ${SUM_ACTIVE_ALLOCATIONS('pa.negotiation_id = n.id')})::numeric(18,2)::text AS remaining
           FROM negotiations n WHERE n.id = $1 AND n.status IN ('ACTIVE','BROKEN')`,
        [negotiationId],
      );
    }
    return this.manager.query(
      `SELECT ni.id AS "installmentId",
              (ni.amount - ${SUM_ACTIVE_ALLOCATIONS('pa.installment_id = ni.id')})::numeric(18,2)::text AS remaining
         FROM negotiation_installments ni
        WHERE ni.negotiation_id = $1 AND ni.status IN ('PENDING','OVERDUE')
        ORDER BY (ni.id IS NOT DISTINCT FROM $2::int) DESC, ni.due_date, ni.installment_number
        FOR UPDATE OF ni`,
      [negotiationId, firstInstallmentId],
    );
  }

  async saveAllocations(paymentId: string, negotiationId: number, paidOn: string, allocations: Allocation[]): Promise<void> {
    if (!allocations.length) return;
    await this.manager.query(
      `INSERT INTO payment_allocations (payment_id, negotiation_id, installment_id, amount, paid_on)
       SELECT $1, $2, x.installment_id, x.amount, $3::date
         FROM unnest($4::int[], $5::numeric[]) AS x(installment_id, amount)`,
      [paymentId, negotiationId, paidOn, allocations.map((a) => a.installmentId), allocations.map((a) => a.amount)],
    );
  }

  async markInstallmentsPaid(ids: number[]): Promise<number> {
    if (!ids.length) return 0;
    const [, n] = await this.manager.query(
      `UPDATE negotiation_installments SET status = 'PAID', paid_at = now(), version = version + 1, updated_at = now()
        WHERE id = ANY($1::int[]) AND status IN ('PENDING','OVERDUE')`,
      [ids],
    );
    return n;
  }

  async completeIfSettled(negotiationId: number, finishedProcessStateId: number, paidInvoiceStateId: number): Promise<CompletionResult> {
    const [r] = await this.manager.query(
      `WITH neg AS (
         UPDATE negotiations n SET status = 'COMPLETED', completed_at = now(), version = version + 1, updated_at = now()
          WHERE n.id = $1 AND n.status = 'ACTIVE'
            AND CASE WHEN n.is_installment
                     THEN NOT EXISTS (SELECT 1 FROM negotiation_installments ni WHERE ni.negotiation_id = n.id AND ni.status IN ('PENDING','OVERDUE'))
                     ELSE ${SUM_ACTIVE_ALLOCATIONS('pa.negotiation_id = n.id')} >= n.final_amount END
         RETURNING n.id, n.created_by_id
       ), procs AS (
         UPDATE processes pr SET closed_at = now(), end_date = now(), process_state_id = $2, closed_reason = 'NEGOTIATION_COMPLETED', updated_at = now()
           FROM negotiation_processes np JOIN neg ON neg.id = np.negotiation_id
          WHERE pr.id = np.process_id AND pr.closed_at IS NULL
         RETURNING pr.id
       ), invs AS (
         UPDATE invoices i SET invoice_state_id = $3, updated_at = now()
           FROM process_invoices pi JOIN procs ON procs.id = pi.process_id
          WHERE i.id = pi.invoice_id
         RETURNING i.id
       ), rel AS (
         UPDATE negotiation_processes np SET is_active = false FROM neg WHERE np.negotiation_id = neg.id RETURNING np.id
       )
       SELECT (SELECT id FROM neg) AS "completedNegotiationId", (SELECT created_by_id FROM neg) AS "negotiationCreatedBy",
              (SELECT count(*) FROM procs)::int AS "processesClosed", (SELECT count(*) FROM invs)::int AS "invoicesPaid",
              (SELECT count(*) FROM rel)::int AS released`,
      [negotiationId, finishedProcessStateId, paidInvoiceStateId],
    );
    return r;
  }

  async reverseAllocations(paymentId: string): Promise<number[]> {
    const [rows] = await this.manager.query(
      `UPDATE payment_allocations SET reversed_at = now() WHERE payment_id = $1 AND reversed_at IS NULL RETURNING installment_id`,
      [paymentId],
    );
    return (rows as Array<{ installment_id: number | null }>).map((r) => r.installment_id).filter((x): x is number => x !== null);
  }

  async reopenInstallments(ids: number[], today: string): Promise<number> {
    if (!ids.length) return 0;
    const [, n] = await this.manager.query(
      `UPDATE negotiation_installments ni
          SET status = CASE WHEN ni.due_date < $2::date THEN 'OVERDUE' ELSE 'PENDING' END, paid_at = NULL,
              version = version + 1, updated_at = now()
        WHERE ni.id = ANY($1::int[]) AND ni.status = 'PAID'
          AND ${SUM_ACTIVE_ALLOCATIONS('pa.installment_id = ni.id')} < ni.amount`,
      [ids, today],
    );
    return n;
  }

  async reopenNegotiation(negotiationId: number, inProgressProcessStateId: number, inProgressInvoiceStateId: number): Promise<boolean> {
    try {
      const [r] = await this.manager.query(
        `WITH neg AS (
           UPDATE negotiations n SET status = 'ACTIVE', completed_at = NULL, version = version + 1, updated_at = now()
            WHERE n.id = $1 AND n.status = 'COMPLETED'
              AND CASE WHEN n.is_installment
                       THEN EXISTS (SELECT 1 FROM negotiation_installments ni WHERE ni.negotiation_id = n.id AND ni.status IN ('PENDING','OVERDUE'))
                       ELSE ${SUM_ACTIVE_ALLOCATIONS('pa.negotiation_id = n.id')} < n.final_amount END
           RETURNING n.id
         ), np AS (
           UPDATE negotiation_processes np SET is_active = true FROM neg WHERE np.negotiation_id = neg.id RETURNING np.process_id
         ), procs AS (
           UPDATE processes pr SET closed_at = NULL, end_date = NULL, process_state_id = $2, updated_at = now()
             FROM np WHERE pr.id = np.process_id
           RETURNING pr.id
         ), invs AS (
           UPDATE invoices i SET invoice_state_id = $3, updated_at = now()
             FROM process_invoices pi JOIN procs ON procs.id = pi.process_id
            WHERE i.id = pi.invoice_id
           RETURNING i.id
         )
         SELECT (SELECT count(*) FROM neg)::int AS n, (SELECT count(*) FROM procs)::int AS p, (SELECT count(*) FROM invs)::int AS i`,
        [negotiationId, inProgressProcessStateId, inProgressInvoiceStateId],
      );
      return r.n > 0;
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new BusinessRuleError('Não é possível estornar: o devedor já tem outro processo/acordo aberto com estes processos. Resolva-o primeiro.');
      }
      throw e;
    }
  }
}

@Injectable()
export class TypeOrmDebtorCreditRepository extends BaseTypeOrmRepository implements DebtorCreditRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async lock(debtorId: number): Promise<void> {
    await this.manager.query(`SELECT pg_advisory_xact_lock(hashtext('debtor-credit'), $1)`, [debtorId]);
  }

  async add(e: DebtorCreditEntry): Promise<void> {
    await this.manager.query(
      `INSERT INTO debtor_credit_entries (debtor_id, organization_id, negotiation_id, payment_id, kind, amount, description, created_by_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [e.debtorId, e.organizationId, e.negotiationId, e.paymentId, e.kind, e.amount, e.description, e.createdById],
    );
  }

  async balanceOf(debtorId: number): Promise<string> {
    const [r] = await this.manager.query(
      'SELECT COALESCE(sum(amount), 0)::numeric(18,2)::text AS b FROM debtor_credit_entries WHERE debtor_id = $1',
      [debtorId],
    );
    return r.b;
  }

  async statement(debtorId: number, page: number, perPage: number): Promise<Page<CreditStatementLine>> {
    const rows: Array<CreditStatementLine & { total: string }> = await this.manager.query(
      `SELECT id::text AS id, debtor_id AS "debtorId", organization_id AS "organizationId", negotiation_id AS "negotiationId",
              payment_id::text AS "paymentId", kind, amount::text AS amount, description, created_by_id AS "createdById",
              created_at AS "createdAt", count(*) OVER () AS total
         FROM debtor_credit_entries WHERE debtor_id = $1
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [debtorId, perPage, (page - 1) * perPage],
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return buildPage(rows.map(({ total: _t, ...r }) => r), total, { page, perPage });
  }
}
