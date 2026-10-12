import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { ConflictError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { Criteria } from '@/shared/domain/criteria';
import { buildPage, Page } from '@/shared/domain/pagination';
import { NegotiationInput } from '../domain/negotiation';
import { OpenInstallment } from '../domain/negotiation-lifecycle';
import {
  Negotiation,
  NegotiationListItem,
  NegotiationQueries,
  NegotiationRepository,
  NegotiationField,
  PaymentSummary,
  InstallmentPaymentState,
  NegotiationDetail,
  NegotiationInvoiceRow,
  ProcessInvoicesSummary,
} from '../domain/negotiation.repository';
import {
  NegotiationInstallmentOrmEntity,
  NegotiationOrmEntity,
  NegotiationProcessOrmEntity,
} from './negotiation.orm-entities';

/** whitelist campo → coluna (fd = devedor do 1.º processo, via LATERAL) */
const NEGOTIATION_FIELDS = new CriteriaCompiler<NegotiationField>({
  status: { column: 'n.status', type: 'enum' },
  debtAmount: { column: 'n.debt_amount', type: 'decimal' },
  totalAmount: { column: 'n.total_amount', type: 'decimal' },
  finalAmount: { column: 'n.final_amount', type: 'decimal' },
  effectiveDate: { column: 'n.effective_date', type: 'date' },
  createdAt: { column: 'n.created_at', type: 'date' },
  updatedAt: { column: 'n.updated_at', type: 'date' },
  createdById: { column: 'n.created_by_id', type: 'number' },
  isInstallment: { column: 'n.is_installment', type: 'boolean' },
  debtorId: { column: 'fd.id', type: 'number' },
  debtorName: { column: 'fd.name', searchable: true },
  debtorNif: { column: 'fd.nif' },
});

const FIRST_DEBTOR_JOIN = `LEFT JOIN LATERAL (
           SELECT d.id, d.name, d.nif FROM negotiation_processes np
             JOIN processes p ON p.id = np.process_id
             JOIN debtors d ON d.id = p.debtor_id
            WHERE np.negotiation_id = n.id
            ORDER BY np.id LIMIT 1
         ) fd ON true`;

/**
 * Prestação NÃO coberta à data de vencimento ("quebra a partir do primeiro dia"):
 * Σ alocações confirmadas com data de pagamento ≤ vencimento + pagamentos PENDENTES do acordo com data ≤ vencimento
 * (o comprovativo prova que pagou a tempo; se o pendente for anulado, a próxima execução quebra).
 */
const UNCOVERED_ON_DUE = `(COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa
                WHERE pa.installment_id = ni.id AND pa.reversed_at IS NULL AND pa.paid_on <= ni.due_date), 0)
     + COALESCE((SELECT sum(p.amount_base) FROM payments p
                WHERE p.negotiation_id = ni.negotiation_id AND p.status = 'PENDING' AND p.paid_on <= ni.due_date), 0)) < ni.amount`;

@Injectable()
export class TypeOrmNegotiationRepository extends BaseTypeOrmRepository implements NegotiationRepository, NegotiationQueries {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  /** 3 INSERTs (cabeçalho, processos, prestações) — deve correr dentro da UnitOfWork. */
  async create(
    i: NegotiationInput,
    createdById: number | null,
    opts: { status?: 'ACTIVE' | 'PENDING_APPROVAL'; previousNegotiationId?: number } = {},
  ): Promise<Negotiation> {
    const status = opts.status ?? 'ACTIVE';
    let neg: Negotiation;
    try {
      neg = await this.repo(NegotiationOrmEntity).save(
      this.repo(NegotiationOrmEntity).create({
        debtAmount: Money.of(i.debtAmount).toString(),
        discountAmount: Money.of(i.discountAmount).toString(),
        discountRate: i.discountRate,
        totalAmount: Money.of(i.totalAmount).toString(),
        finalAmount: Money.of(i.finalAmount).toString(),
        effectiveDate: i.effectiveDate,
        startDate: i.startDate,
        endDate: i.endDate,
        isInstallment: i.isInstallment,
        isEqualInstallments: i.isEqualInstallments,
        totalInstallments: i.isInstallment ? (i.totalInstallments ?? null) : null,
        notes: i.notes ?? null,
        createdById,
        status,
        startedAt: status === 'ACTIVE' ? new Date() : null,
        previousNegotiationId: opts.previousNegotiationId ?? null,
      }),
    );
    } catch (e) {
      // dois pedidos simultâneos para renegociar o mesmo acordo → o segundo falha aqui
      if (isUniqueViolation(e, 'ux_negotiations_previous')) throw new ConflictError('Este acordo já foi renegociado');
      throw e;
    }
    try {
      await this.repo(NegotiationProcessOrmEntity).insert(i.processIds.map((processId) => ({ negotiationId: neg.id, processId, isActive: true })));
    } catch (e) {
      // última barreira contra corrida: índice único parcial ux_negotiation_processes_active
      if (isUniqueViolation(e, 'ux_negotiation_processes_active')) throw new ConflictError('Um dos processos já está numa negociação activa');
      throw e;
    }
    if (i.isInstallment && i.installments?.length) {
      await this.repo(NegotiationInstallmentOrmEntity).insert(
        i.installments.map((p) => ({
          negotiationId: neg.id,
          installmentNumber: p.installmentNumber,
          amount: Money.of(p.amount).toString(),
          percentage: p.percentage,
          dueDate: p.dueDate,
          penaltyPercentage: p.penaltyPercentage,
          status: 'PENDING' as const,
        })),
      );
    }
    return neg;
  }

  async processesInActiveNegotiation(ids: number[]): Promise<number[]> {
    const rows = await this.repo(NegotiationProcessOrmEntity).find({ select: { processId: true }, where: { processId: In(ids), isActive: true } });
    return rows.map((r) => r.processId);
  }

  findForUpdate(id: number): Promise<Negotiation | null> {
    return this.repo(NegotiationOrmEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  async cancel(id: number, expectedVersion: number): Promise<boolean> {
    const [, affected] = await this.manager.query(
      `UPDATE negotiations SET status = 'CANCELLED', cancelled_at = now(), version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status IN ('ACTIVE','PENDING_APPROVAL')`,
      [id, expectedVersion],
    );
    if (!affected) return false;
    await this.releaseProcessesAndInstallments(id);
    return true;
  }

  /** liberta os processos (podem voltar a ser negociados) e cancela as prestações em aberto */
  private async releaseProcessesAndInstallments(id: number): Promise<void> {
    await this.manager.query('UPDATE negotiation_processes SET is_active = false WHERE negotiation_id = $1', [id]);
    await this.manager.query(
      `UPDATE negotiation_installments SET status = 'CANCELLED', version = version + 1, updated_at = now()
        WHERE negotiation_id = $1 AND status IN ('PENDING','OVERDUE')`,
      [id],
    );
  }

  async approve(id: number, expectedVersion: number, approverId: number): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE negotiations SET status = 'ACTIVE', authorized_by_id = $3, approved_at = now(), started_at = now(),
              version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'PENDING_APPROVAL'`,
      [id, expectedVersion, approverId],
    );
    return n > 0;
  }

  async reject(id: number, expectedVersion: number, approverId: number, reason: string): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE negotiations SET status = 'REJECTED', authorized_by_id = $3, rejected_at = now(), rejection_reason = $4,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'PENDING_APPROVAL'`,
      [id, expectedVersion, approverId, reason],
    );
    if (n) await this.releaseProcessesAndInstallments(id);
    return n > 0;
  }

  async break(id: number, expectedVersion: number, byUserId: number, reason: string): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE negotiations SET status = 'BROKEN', broken_at = now(), broken_by_id = $3, break_reason = $4,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'ACTIVE'`,
      [id, expectedVersion, byUserId, reason],
    );
    if (n) await this.manager.query('UPDATE negotiation_processes SET is_active = false WHERE negotiation_id = $1', [id]);
    return n > 0;
  }

  /**
   * "Quebra a partir do primeiro dia": um único statement para todos os acordos.
   * Prestações vencidas → OVERDUE; acordo → BROKEN com o motivo (prestação mais antiga); processos libertados.
   * Idempotente: na 2.ª execução já não há acordos ACTIVE com prestações vencidas.
   */
  async autoBreakOverdue(today: string): Promise<Array<{ negotiationId: number; createdById: number | null }>> {
    // 1) bloqueia os acordos candidatos; SKIP LOCKED: um acordo a meio de um registo/confirmação de pagamento
    //    é saltado e reavaliado na próxima execução (sem esperas nem deadlocks com os pagamentos)
    const locked: Array<{ id: number }> = await this.manager.query(
      `SELECT n.id FROM negotiations n
        WHERE n.status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM negotiation_installments ni
                       WHERE ni.negotiation_id = n.id AND ni.status IN ('PENDING','OVERDUE') AND ni.due_date < $1::date AND ${UNCOVERED_ON_DUE})
        ORDER BY n.id FOR UPDATE SKIP LOCKED`,
      [today],
    );
    if (!locked.length) return [];
    return this.manager.query(
      `WITH late AS (
         SELECT DISTINCT ON (ni.negotiation_id) ni.negotiation_id, ni.due_date AS first_due, ni.installment_number AS inst
           FROM negotiation_installments ni
          WHERE ni.negotiation_id = ANY($2::int[]) AND ni.status IN ('PENDING','OVERDUE') AND ni.due_date < $1::date
            AND ${UNCOVERED_ON_DUE}
          ORDER BY ni.negotiation_id, ni.due_date, ni.installment_number
       ), od AS (
         UPDATE negotiation_installments ni SET status = 'OVERDUE', version = version + 1, updated_at = now()
           FROM late WHERE ni.negotiation_id = late.negotiation_id AND ni.status = 'PENDING' AND ni.due_date < $1::date
         RETURNING ni.id
       ), br AS (
         UPDATE negotiations n SET status = 'BROKEN', broken_at = now(), broken_by_id = NULL,
                break_reason = 'Automática: prestação ' || late.inst || ' vencida em ' || to_char(late.first_due, 'DD/MM/YYYY') || ' sem pagamento',
                version = version + 1, updated_at = now()
           FROM late WHERE n.id = late.negotiation_id AND n.status = 'ACTIVE'
         RETURNING n.id, n.created_by_id
       ), rel AS (
         UPDATE negotiation_processes np SET is_active = false FROM br WHERE np.negotiation_id = br.id RETURNING np.id
       )
       SELECT br.id AS "negotiationId", br.created_by_id AS "createdById", (SELECT count(*) FROM od) AS o, (SELECT count(*) FROM rel) AS r FROM br`,
      [today, locked.map((l) => l.id)],
    );
  }

  async markRenegotiated(id: number, expectedVersion: number): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE negotiations SET status = 'RENEGOTIATED', renegotiated_at = now(), version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status IN ('ACTIVE','BROKEN')`,
      [id, expectedVersion],
    );
    if (n) await this.releaseProcessesAndInstallments(id);
    return n > 0;
  }

  /** capital em aberto por prestação = valor − pagamentos confirmados já alocados (pagamento parcial abate) */
  openInstallments(id: number): Promise<OpenInstallment[]> {
    return this.manager.query(
      `SELECT x."installmentNumber", x.amount::text AS amount, x."dueDate", x."penaltyPercentage"
         FROM (SELECT ni.installment_number AS "installmentNumber",
                      (ni.amount - COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa
                                              WHERE pa.installment_id = ni.id AND pa.reversed_at IS NULL), 0))::numeric(18,2) AS amount,
                      to_char(ni.due_date, 'YYYY-MM-DD') AS "dueDate", ni.penalty_percentage::text AS "penaltyPercentage"
                 FROM negotiation_installments ni WHERE ni.negotiation_id = $1 AND ni.status IN ('PENDING','OVERDUE')) x
        WHERE x.amount > 0
        ORDER BY x."installmentNumber"`,
      [id],
    );
  }

  async paymentSummary(id: number): Promise<PaymentSummary> {
    const [r] = await this.manager.query(
      `SELECT (SELECT count(*) FROM payments p WHERE p.negotiation_id = $1 AND p.status = 'PENDING')::int AS pending,
              (SELECT count(*) FROM payments p WHERE p.negotiation_id = $1 AND p.status = 'CONFIRMED')::int AS confirmed,
              COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa WHERE pa.negotiation_id = $1 AND pa.reversed_at IS NULL), 0)::numeric(18,2)::text AS allocated`,
      [id],
    );
    return r;
  }

  async processIdsOf(id: number): Promise<number[]> {
    const rows: Array<{ process_id: number }> = await this.manager.query(
      'SELECT process_id FROM negotiation_processes WHERE negotiation_id = $1 ORDER BY process_id',
      [id],
    );
    return rows.map((r) => r.process_id);
  }

  /**
   * Lista com filtros dinâmicos, contagem de processos e devedor do 1.º processo:
   * LATERAL JOIN + subquery de contagem — 1 query + 1 count, sem N+1.
   */
  async search(criteria: Criteria<NegotiationField>): Promise<Page<NegotiationListItem>> {
    const c = NEGOTIATION_FIELDS.compile(criteria);
    const rows = await this.manager.query(
      `SELECT n.id, n.status, n.debt_amount AS "debtAmount", n.total_amount AS "totalAmount", n.final_amount AS "finalAmount",
              n.discount_rate AS "discountRate", n.is_installment AS "isInstallment",
              n.total_installments AS "totalInstallments", to_char(n.effective_date, 'YYYY-MM-DD') AS "effectiveDate",
              to_char(n.start_date, 'YYYY-MM-DD') AS "startDate", to_char(n.end_date, 'YYYY-MM-DD') AS "endDate",
              n.created_at AS "createdAt",
              (SELECT count(*) FROM negotiation_processes np WHERE np.negotiation_id = n.id)::int AS "processesCount",
              CASE WHEN fd.id IS NULL THEN NULL ELSE json_build_object('id', fd.id, 'name', fd.name, 'nif', fd.nif) END AS debtor
         FROM negotiations n
         ${FIRST_DEBTOR_JOIN}
        WHERE ${c.where}
        ORDER BY ${c.orderBy}, n.id DESC
        LIMIT $${c.params.length + 1} OFFSET $${c.params.length + 2}`,
      [...c.params, c.limit, c.offset],
    );
    const [{ total }] = await this.manager.query(
      `SELECT count(*)::int AS total FROM negotiations n ${FIRST_DEBTOR_JOIN} WHERE ${c.where}`,
      c.params,
    );
    return buildPage(rows, total, { page: criteria.page, perPage: criteria.perPage });
  }

  /**
   * Antes: 1 JOIN processos × prestações (produto cartesiano) + TODAS as facturas hidratadas pelo ORM
   * (milhares de entidades e um JSON enorme). Agora:
   *  - `relationLoadStrategy: 'query'` → cada relação na sua query (sem produto cartesiano);
   *  - facturas AGREGADAS na BD por processo/moeda/estado (poucas linhas, usa ix_process_invoices_process);
   *  - a lista de facturas é paginada em GET /negotiations/:id/invoices.
   */
  async findDetailed(id: number): Promise<NegotiationDetail | null> {
    const neg = await this.repo(NegotiationOrmEntity).findOne({
      where: { id },
      relations: { processes: { process: { processState: true, debtor: true } }, installments: true },
      relationLoadStrategy: 'query',
      // NB: a ordenação das prestações é feita em memória — `order` por coluna de relação com
      // `relationLoadStrategy: 'query'` faz o TypeORM gerar, no findOne, um alias inexistente
      // na subquery ("column distinctAlias.<hash> does not exist" → 500 no detalhe e na criação).
    });
    if (!neg) return null;
    neg.installments?.sort((a, b) => a.installmentNumber - b.installmentNumber);
    if (neg.processes?.length) {
      const summaries = await this.invoiceSummaries(neg.processes.map((p) => p.processId));
      for (const np of neg.processes) {
        Object.assign(np.process ?? {}, { invoicesSummary: summaries.get(np.processId) ?? { count: 0, totals: [], byState: [] } });
      }
    }
    return this.withPayments(neg);
  }

  private async invoiceSummaries(processIds: number[]): Promise<Map<number, ProcessInvoicesSummary>> {
    const rows: Array<{ processId: number; currency: string; state: string; count: number; amount: string }> = await this.manager.query(
      `SELECT pi.process_id AS "processId", c.code AS currency, s.code AS state, count(*)::int AS count, sum(i.amount)::numeric(18,2)::text AS amount
         FROM process_invoices pi
         JOIN invoices i ON i.id = pi.invoice_id
         JOIN currencies c ON c.id = i.currency_id
         JOIN invoice_states s ON s.id = i.invoice_state_id
        WHERE pi.process_id = ANY($1::int[])
        GROUP BY pi.process_id, c.code, s.code
        ORDER BY pi.process_id, c.code, s.code`,
      [processIds],
    );
    const out = new Map<number, ProcessInvoicesSummary>();
    for (const r of rows) {
      const sum = out.get(r.processId) ?? { count: 0, totals: [], byState: [] };
      sum.count += r.count;
      sum.byState.push({ state: r.state, currency: r.currency, count: r.count, amount: r.amount });
      const t = sum.totals.find((x) => x.currency === r.currency);
      if (t) {
        t.count += r.count;
        t.amount = Money.of(t.amount).plus(r.amount).toString();
      } else sum.totals.push({ currency: r.currency, count: r.count, amount: r.amount });
      out.set(r.processId, sum);
    }
    return out;
  }

  async invoicesOf(negotiationId: number, page: number, perPage: number, state?: string): Promise<Page<NegotiationInvoiceRow>> {
    const from = `
      FROM negotiation_processes np
      JOIN process_invoices pi ON pi.process_id = np.process_id
      JOIN invoices i ON i.id = pi.invoice_id
      JOIN invoice_states s ON s.id = i.invoice_state_id
      JOIN currencies c ON c.id = i.currency_id
     WHERE np.negotiation_id = $1 AND ($2::text IS NULL OR s.code = $2)`;
    const [rows, [{ total }]] = await Promise.all([
      this.manager.query(
        `SELECT i.id, pi.process_id AS "processId", i.reference_number AS "referenceNumber", i.amount::text AS amount, c.code AS currency,
                to_char(i.issue_date, 'YYYY-MM-DD') AS "issueDate", to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
                s.code AS state, s.name AS "stateName", (i.document_path IS NOT NULL) AS "hasDocument"
           ${from}
          ORDER BY i.due_date, i.id
          LIMIT $3 OFFSET $4`,
        [negotiationId, state ?? null, perPage, (page - 1) * perPage],
      ),
      this.manager.query(`SELECT count(*)::int AS total ${from}`, [negotiationId, state ?? null]),
    ]);
    return buildPage(rows, total, { page, perPage });
  }

  /** "pago / em falta" por prestação e totais do acordo: 1 query (agregados por LATERAL, índices parciais) */
  private async withPayments(neg: Negotiation): Promise<NegotiationDetail> {
    const rows: Array<{ installmentId: number | null; paid: string; pending: string; credit: string; pendingCount: number; confirmedCount: number }> =
      await this.manager.query(
        `SELECT ni.id AS "installmentId",
                COALESCE(a.paid, 0)::numeric(18,2)::text AS paid,
                COALESCE(pp.pending, 0)::numeric(18,2)::text AS pending,
                '0' AS credit, 0 AS "pendingCount", 0 AS "confirmedCount"
           FROM negotiation_installments ni
           LEFT JOIN LATERAL (SELECT sum(pa.amount) AS paid FROM payment_allocations pa
                               WHERE pa.installment_id = ni.id AND pa.reversed_at IS NULL) a ON true
           LEFT JOIN LATERAL (SELECT sum(p.amount_base) AS pending FROM payments p
                               WHERE p.negotiation_id = $1 AND p.installment_id = ni.id AND p.status = 'PENDING') pp ON true
          WHERE ni.negotiation_id = $1
         UNION ALL
         SELECT NULL,
                COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa WHERE pa.negotiation_id = $1 AND pa.reversed_at IS NULL), 0)::numeric(18,2)::text,
                COALESCE((SELECT sum(p.amount_base) FROM payments p WHERE p.negotiation_id = $1 AND p.status = 'PENDING'), 0)::numeric(18,2)::text,
                COALESCE((SELECT sum(p.credit_amount) FROM payments p WHERE p.negotiation_id = $1 AND p.status = 'CONFIRMED'), 0)::numeric(18,2)::text,
                (SELECT count(*) FROM payments p WHERE p.negotiation_id = $1 AND p.status = 'PENDING')::int,
                (SELECT count(*) FROM payments p WHERE p.negotiation_id = $1 AND p.status = 'CONFIRMED')::int`,
        [neg.id],
      );
    const byInstallment = new Map(rows.filter((r) => r.installmentId !== null).map((r) => [r.installmentId as number, r]));
    const total = rows.find((r) => r.installmentId === null)!;

    const installments = (neg.installments ?? []).map((i) => {
      const r = byInstallment.get(i.id);
      const paid = Money.of(r?.paid ?? '0');
      const open = i.status === 'PENDING' || i.status === 'OVERDUE';
      const remaining = open ? Money.of(i.amount).minus(paid) : Money.zero();
      const paymentState: InstallmentPaymentState =
        i.status === 'CANCELLED' ? 'CANCELLED' : i.status === 'PAID' || !remaining.isPositive() ? 'PAID' : paid.isPositive() ? 'PARTIALLY_PAID' : 'UNPAID';
      return Object.assign(i, {
        paidAmount: paid.toString(),
        pendingAmount: Money.of(r?.pending ?? '0').toString(),
        remainingAmount: (remaining.isPositive() ? remaining : Money.zero()).toString(),
        paymentState,
      });
    });

    const paid = Money.of(total.paid);
    const remaining = Money.of(neg.finalAmount).minus(paid);
    const final = Money.of(neg.finalAmount);
    return Object.assign(neg, {
      installments,
      paymentTotals: {
        finalAmount: final.toString(),
        paidAmount: paid.toString(),
        pendingAmount: Money.of(total.pending).toString(),
        remainingAmount: (remaining.isPositive() ? remaining : Money.zero()).toString(),
        creditGenerated: Money.of(total.credit).toString(),
        progressPercent: final.isPositive() ? Money.of(paid.ratioOf(final).gt(100) ? 100 : paid.ratioOf(final)).toString() : '0.00',
        pendingPayments: Number(total.pendingCount),
        confirmedPayments: Number(total.confirmedCount),
      },
    });
  }
}
