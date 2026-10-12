import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const TODAY = `(now() AT TIME ZONE 'Africa/Luanda')::date`;
const BASE = (p: string) => `(SELECT id FROM currencies WHERE code = ${p})`;

export interface ReceivableAt { day: string; receivable: string; currentNotDue: string }
export interface PeriodFacts {
  sales: string; salesCount: number; recovered: string; recoveredCount: number; commissions: string;
  costsOrg: string; costsGeneral: string; recoveredAll: string;
}
export interface OpenInvoiceRow {
  id: number; reference: string; amount: string; outstanding: string; issueDate: string; dueDate: string; daysOverdue: number; state: string;
  debtorId: number; debtorName: string; nif: string | null; organizationId: number; organizationName: string;
  processId: number | null; agentId: number | null; agentName: string | null; negotiationId: number | null; negotiationStatus: string | null;
}
export interface InstallmentRow {
  id: number | null; negotiationId: number; number: number | null; of: number | null; dueDate: string; remaining: string; status: string;
  debtorName: string; organizationName: string; agentName: string | null;
}
export interface ContactRow {
  id: number; contactedAt: string; agentId: number; agentName: string | null; debtorName: string; organizationName: string; processId: number;
  type: string; status: string; durationSeconds: number | null; notes: string | null;
}
export interface BrokenRow {
  id: number; debtorName: string; organizationName: string; agentName: string | null; createdByName: string | null; startedAt: string | null;
  brokenAt: string; agreed: string; paid: string; missing: string; installmentsPaid: number; installmentsTotal: number;
  breakReason: string; brokenByName: string | null; automatic: boolean; renegotiatedId: number | null; status: string;
}
export interface DisputeRow {
  id: number; invoiceId: number; reference: string; debtorName: string; organizationName: string; agentName: string | null; originalAmount: string;
  adjustedAmount: string | null; reason: string; status: string; outcome: string | null; openedAt: string; openedByName: string | null;
  resolvedAt: string | null; resolvedByName: string | null; resolutionNotes: string | null; days: number;
}

/**
 * Consultas dos relatórios de Contas a Receber. Tudo na moeda base; datas no calendário de Luanda.
 *
 * Saldo a receber numa data D (modelo de razão, permite séries históricas):
 *   Σ facturas emitidas até D (não anuladas) − Σ pagamentos confirmados até D (sem o excedente que virou crédito)
 *   − Σ descontos de acordos em vigor/concluídos iniciados até D.
 *
 * Em aberto por factura (aging, hoje): factura sem acordo → valor total; com acordo → o que falta do acordo,
 * repartido pelas facturas do acordo na proporção do valor de cada uma (acordo quebrado: o desconto perde-se).
 */
@Injectable()
export class SqlReportQueries {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  receivableAt(currency: string, days: string[], orgId: number | null): Promise<ReceivableAt[]> {
    return this.ds.query(
      `WITH d AS (SELECT unnest($2::date[]) AS day),
       inv AS (
         SELECT i.amount, i.issue_date, i.due_date, s.code
           FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id JOIN debtors dd ON dd.id = i.debtor_id
          WHERE i.currency_id = ${BASE('$1')} AND s.code <> 'CANCELLED' AND ($3::int IS NULL OR dd.organization_id = $3)
       ), pay AS (
         SELECT p.paid_on, p.amount_base - COALESCE(p.credit_amount, 0) AS amount
           FROM payments p WHERE p.status = 'CONFIRMED' AND ($3::int IS NULL OR p.organization_id = $3)
       ), disc AS (
         SELECT (n.started_at AT TIME ZONE 'Africa/Luanda')::date AS day, n.discount_amount AS amount
           FROM negotiations n
          WHERE n.started_at IS NOT NULL AND n.status IN ('ACTIVE','COMPLETED') AND n.discount_amount > 0
            AND ($3::int IS NULL OR EXISTS (
                  SELECT 1 FROM negotiation_processes np JOIN processes pr ON pr.id = np.process_id JOIN debtors dd ON dd.id = pr.debtor_id
                   WHERE np.negotiation_id = n.id AND dd.organization_id = $3))
       )
       SELECT d.day::text AS day,
              GREATEST(COALESCE((SELECT sum(amount) FROM inv WHERE inv.issue_date <= d.day), 0)
                     - COALESCE((SELECT sum(amount) FROM pay WHERE pay.paid_on <= d.day), 0)
                     - COALESCE((SELECT sum(amount) FROM disc WHERE disc.day <= d.day), 0), 0)::numeric(18,2)::text AS receivable,
              COALESCE((SELECT sum(amount) FROM inv WHERE inv.issue_date <= d.day AND inv.due_date > d.day AND inv.code <> 'PAID'), 0)::numeric(18,2)::text AS "currentNotDue"
         FROM d ORDER BY d.day`,
      [currency, days, orgId],
    );
  }

  async periodFacts(currency: string, from: string, to: string, orgId: number | null): Promise<PeriodFacts> {
    const [r] = await this.ds.query(
      `SELECT
         (SELECT COALESCE(sum(i.amount), 0) FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id JOIN debtors dd ON dd.id = i.debtor_id
           WHERE i.currency_id = ${BASE('$1')} AND s.code <> 'CANCELLED' AND i.issue_date BETWEEN $2 AND $3 AND ($4::int IS NULL OR dd.organization_id = $4))::numeric(18,2)::text AS sales,
         (SELECT count(*) FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id JOIN debtors dd ON dd.id = i.debtor_id
           WHERE i.currency_id = ${BASE('$1')} AND s.code <> 'CANCELLED' AND i.issue_date BETWEEN $2 AND $3 AND ($4::int IS NULL OR dd.organization_id = $4))::int AS "salesCount",
         (SELECT COALESCE(sum(p.amount_base), 0) FROM payments p WHERE p.status = 'CONFIRMED' AND p.paid_on BETWEEN $2 AND $3 AND ($4::int IS NULL OR p.organization_id = $4))::numeric(18,2)::text AS recovered,
         (SELECT count(*) FROM payments p WHERE p.status = 'CONFIRMED' AND p.paid_on BETWEEN $2 AND $3 AND ($4::int IS NULL OR p.organization_id = $4))::int AS "recoveredCount",
         (SELECT COALESCE(sum(p.commission_amount), 0) FROM payments p WHERE p.status = 'CONFIRMED' AND p.paid_on BETWEEN $2 AND $3 AND ($4::int IS NULL OR p.organization_id = $4))::numeric(18,2)::text AS commissions,
         (SELECT COALESCE(sum(c.amount), 0) FROM collection_costs c WHERE c.cost_date BETWEEN $2 AND $3 AND c.organization_id IS NOT NULL AND ($4::int IS NULL OR c.organization_id = $4))::numeric(18,2)::text AS "costsOrg",
         (SELECT COALESCE(sum(c.amount), 0) FROM collection_costs c WHERE c.cost_date BETWEEN $2 AND $3 AND c.organization_id IS NULL)::numeric(18,2)::text AS "costsGeneral",
         (SELECT COALESCE(sum(p.amount_base), 0) FROM payments p WHERE p.status = 'CONFIRMED' AND p.paid_on BETWEEN $2 AND $3)::numeric(18,2)::text AS "recoveredAll"`,
      [currency, from, to, orgId],
    );
    return r;
  }

  /** facturas com valor em aberto hoje (base do aging e da previsão) */
  openInvoices(currency: string, f: { organizationId?: number | null; agentId?: number | null }): Promise<OpenInvoiceRow[]> {
    return this.ds.query(
      `WITH latest AS (
         SELECT DISTINCT ON (np.process_id) np.process_id, n.id AS negotiation_id
           FROM negotiation_processes np JOIN negotiations n ON n.id = np.negotiation_id
          WHERE n.status NOT IN ('CANCELLED','REJECTED')
          ORDER BY np.process_id, n.id DESC
       ), neg AS (
         SELECT n.id, n.status,
                GREATEST(CASE WHEN n.status = 'COMPLETED' THEN 0
                              WHEN n.status IN ('BROKEN','RENEGOTIATED') THEN n.debt_amount
                              ELSE n.final_amount END
                         - COALESCE((SELECT sum(al.amount) FROM payment_allocations al WHERE al.negotiation_id = n.id AND al.reversed_at IS NULL), 0), 0) AS remaining,
                (SELECT sum(i2.amount) FROM negotiation_processes np2 JOIN process_invoices pi2 ON pi2.process_id = np2.process_id
                   JOIN invoices i2 ON i2.id = pi2.invoice_id WHERE np2.negotiation_id = n.id) AS inv_total
           FROM negotiations n WHERE n.id IN (SELECT negotiation_id FROM latest)
       ), rows AS (
         SELECT i.id, i.reference_number AS reference, i.amount, i.issue_date, i.due_date, (${TODAY} - i.due_date) AS days_overdue, s.code AS state,
                d.id AS debtor_id, d.name AS debtor_name, d.nif, o.id AS org_id, o.name AS org_name,
                pi.process_id, pa.user_id AS agent_id, u.full_name AS agent_name, neg.id AS negotiation_id, neg.status AS negotiation_status,
                CASE WHEN neg.id IS NOT NULL AND neg.inv_total > 0 THEN round(i.amount * neg.remaining / neg.inv_total, 2) ELSE i.amount END AS outstanding
           FROM invoices i
           JOIN invoice_states s ON s.id = i.invoice_state_id
           JOIN debtors d ON d.id = i.debtor_id
           JOIN organizations o ON o.id = d.organization_id
           LEFT JOIN process_invoices pi ON pi.invoice_id = i.id
           LEFT JOIN process_assignments pa ON pa.process_id = pi.process_id
           LEFT JOIN users u ON u.id = pa.user_id
           LEFT JOIN latest l ON l.process_id = pi.process_id
           LEFT JOIN neg ON neg.id = l.negotiation_id
          WHERE i.currency_id = ${BASE('$1')} AND s.code NOT IN ('PAID','CANCELLED')
            AND ($2::int IS NULL OR d.organization_id = $2) AND ($3::int IS NULL OR pa.user_id = $3)
       )
       SELECT id, reference, amount::text, outstanding::numeric(18,2)::text AS outstanding, issue_date::text AS "issueDate", due_date::text AS "dueDate",
              days_overdue AS "daysOverdue", state, debtor_id AS "debtorId", debtor_name AS "debtorName", nif, org_id AS "organizationId",
              org_name AS "organizationName", process_id AS "processId", agent_id AS "agentId", agent_name AS "agentName",
              negotiation_id AS "negotiationId", negotiation_status AS "negotiationStatus"
         FROM rows WHERE outstanding > 0
        ORDER BY days_overdue DESC, debtor_name, reference`,
      [currency, f.organizationId ?? null, f.agentId ?? null],
    );
  }

  /** prestações por pagar de acordos em vigor (+ acordos à vista, com vencimento = fim do acordo) até `until` */
  openInstallments(until: string, f: { organizationId?: number | null; agentId?: number | null }): Promise<InstallmentRow[]> {
    return this.ds.query(
      `WITH n AS (
         SELECT n.*, x.debtor_id, x.agent_id
           FROM negotiations n
           LEFT JOIN LATERAL (
             SELECT pr.debtor_id, pa.user_id AS agent_id FROM negotiation_processes np JOIN processes pr ON pr.id = np.process_id
               LEFT JOIN process_assignments pa ON pa.process_id = pr.id WHERE np.negotiation_id = n.id ORDER BY np.id DESC LIMIT 1
           ) x ON true
          WHERE n.status = 'ACTIVE'
       ), items AS (
         SELECT ni.id, n.id AS negotiation_id, ni.installment_number AS number, n.total_installments AS of, ni.due_date, ni.status,
                GREATEST(ni.amount - COALESCE((SELECT sum(al.amount) FROM payment_allocations al WHERE al.installment_id = ni.id AND al.reversed_at IS NULL), 0), 0) AS remaining,
                n.debtor_id, n.agent_id
           FROM n JOIN negotiation_installments ni ON ni.negotiation_id = n.id
          WHERE n.is_installment AND ni.status IN ('PENDING','OVERDUE')
         UNION ALL
         SELECT NULL, n.id, NULL, NULL, n.end_date, 'PENDING',
                GREATEST(n.final_amount - COALESCE((SELECT sum(al.amount) FROM payment_allocations al WHERE al.negotiation_id = n.id AND al.reversed_at IS NULL), 0), 0),
                n.debtor_id, n.agent_id
           FROM n WHERE NOT n.is_installment
       )
       SELECT it.id, it.negotiation_id AS "negotiationId", it.number, it.of, it.due_date::text AS "dueDate", it.remaining::numeric(18,2)::text AS remaining,
              CASE WHEN it.due_date < ${TODAY} THEN 'OVERDUE' ELSE 'PENDING' END AS status,
              d.name AS "debtorName", o.name AS "organizationName", u.full_name AS "agentName"
         FROM items it
         JOIN debtors d ON d.id = it.debtor_id
         JOIN organizations o ON o.id = d.organization_id
         LEFT JOIN users u ON u.id = it.agent_id
        WHERE it.remaining > 0 AND it.due_date <= $1
          AND ($2::int IS NULL OR d.organization_id = $2) AND ($3::int IS NULL OR it.agent_id = $3)
        ORDER BY it.due_date, d.name`,
      [until, f.organizationId ?? null, f.agentId ?? null],
    );
  }

  async pendingPayments(orgId: number | null): Promise<{ amount: string; count: number }> {
    const [r] = await this.ds.query(
      `SELECT COALESCE(sum(amount_base), 0)::numeric(18,2)::text AS amount, count(*)::int AS count
         FROM payments WHERE status = 'PENDING' AND ($1::int IS NULL OR organization_id = $1)`,
      [orgId],
    );
    return r;
  }

  /** taxas históricas (últimos 180 dias) usadas para ponderar a previsão */
  async historicalRates(currency: string, orgId: number | null): Promise<{ installmentRate: string | null; invoiceRate: string | null }> {
    const [r] = await this.ds.query(
      `SELECT
         (SELECT CASE WHEN sum(ni.amount) > 0 THEN sum(LEAST(ni.amount, COALESCE(a.paid, 0))) / sum(ni.amount) END
            FROM negotiation_installments ni
            JOIN negotiations n ON n.id = ni.negotiation_id AND n.status NOT IN ('CANCELLED','REJECTED','PENDING_APPROVAL')
            LEFT JOIN LATERAL (SELECT sum(al.amount) AS paid FROM payment_allocations al WHERE al.installment_id = ni.id AND al.reversed_at IS NULL) a ON true
           WHERE ni.due_date BETWEEN ${TODAY} - 180 AND ${TODAY} - 1 AND ni.status <> 'CANCELLED'
             AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM payments p WHERE p.negotiation_id = n.id AND p.organization_id = $2)
                  OR EXISTS (SELECT 1 FROM negotiation_processes np JOIN processes pr ON pr.id = np.process_id JOIN debtors dd ON dd.id = pr.debtor_id
                              WHERE np.negotiation_id = n.id AND dd.organization_id = $2)))::numeric(9,4)::text AS "installmentRate",
         (SELECT CASE WHEN sum(i.amount) > 0 THEN sum(i.amount) FILTER (WHERE s.code = 'PAID') / sum(i.amount) END
            FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id JOIN debtors dd ON dd.id = i.debtor_id
           WHERE i.currency_id = ${BASE('$1')} AND s.code <> 'CANCELLED' AND i.due_date BETWEEN ${TODAY} - 180 AND ${TODAY} - 1
             AND ($2::int IS NULL OR dd.organization_id = $2))::numeric(9,4)::text AS "invoiceRate"`,
      [currency, orgId],
    );
    return r;
  }

  contacts(f: { from: string; to: string; organizationId?: number | null; agentId?: number | null; status?: string | null; contactTypeId?: number | null }, limit: number): Promise<ContactRow[]> {
    return this.ds.query(
      `SELECT c.id, c.contacted_at AS "contactedAt", c.user_id AS "agentId", u.full_name AS "agentName", d.name AS "debtorName",
              o.name AS "organizationName", c.process_id AS "processId", ct.name AS type, c.status, c.duration_seconds AS "durationSeconds", c.notes
         FROM contacts c
         JOIN processes pr ON pr.id = c.process_id
         JOIN debtors d ON d.id = pr.debtor_id
         JOIN organizations o ON o.id = d.organization_id
         JOIN contact_types ct ON ct.id = c.contact_type_id
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.contacted_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Luanda') AND c.contacted_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda')
          AND ($3::int IS NULL OR d.organization_id = $3) AND ($4::int IS NULL OR c.user_id = $4)
          AND ($5::text IS NULL OR c.status = $5) AND ($6::int IS NULL OR c.contact_type_id = $6)
        ORDER BY c.contacted_at DESC, c.id DESC
        LIMIT $7`,
      [f.from, f.to, f.organizationId ?? null, f.agentId ?? null, f.status ?? null, f.contactTypeId ?? null, limit],
    );
  }

  /** acordos quebrados no período + acordos concluídos no período (para a taxa de quebra) */
  async brokenAgreements(f: { from: string; to: string; organizationId?: number | null; agentId?: number | null }): Promise<{ rows: BrokenRow[]; completed: number }> {
    const params = [f.from, f.to, f.organizationId ?? null, f.agentId ?? null];
    const scope = `
      LEFT JOIN LATERAL (
        SELECT pr.debtor_id, pa.user_id AS agent_id FROM negotiation_processes np JOIN processes pr ON pr.id = np.process_id
          LEFT JOIN process_assignments pa ON pa.process_id = pr.id WHERE np.negotiation_id = n.id ORDER BY np.id DESC LIMIT 1
      ) x ON true
      JOIN debtors d ON d.id = x.debtor_id
      JOIN organizations o ON o.id = d.organization_id`;
    const inPeriod = (col: string) => `${col} >= ($1::date::timestamp AT TIME ZONE 'Africa/Luanda') AND ${col} < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda')`;
    const filters = `($3::int IS NULL OR d.organization_id = $3) AND ($4::int IS NULL OR x.agent_id = $4)`;
    const rows: BrokenRow[] = await this.ds.query(
      `SELECT n.id, d.name AS "debtorName", o.name AS "organizationName", ag.full_name AS "agentName", cb.full_name AS "createdByName",
              n.started_at AS "startedAt", n.broken_at AS "brokenAt", n.final_amount::text AS agreed,
              COALESCE(a.paid, 0)::numeric(18,2)::text AS paid, GREATEST(n.final_amount - COALESCE(a.paid, 0), 0)::numeric(18,2)::text AS missing,
              (SELECT count(*) FROM negotiation_installments ni WHERE ni.negotiation_id = n.id AND ni.status = 'PAID')::int AS "installmentsPaid",
              COALESCE(n.total_installments, 1) AS "installmentsTotal",
              n.break_reason AS "breakReason", bb.full_name AS "brokenByName", (n.broken_by_id IS NULL) AS automatic,
              (SELECT r.id FROM negotiations r WHERE r.previous_negotiation_id = n.id) AS "renegotiatedId", n.status
         FROM negotiations n
         ${scope}
         LEFT JOIN users ag ON ag.id = x.agent_id
         LEFT JOIN users cb ON cb.id = n.created_by_id
         LEFT JOIN users bb ON bb.id = n.broken_by_id
         LEFT JOIN LATERAL (SELECT sum(al.amount) AS paid FROM payment_allocations al WHERE al.negotiation_id = n.id AND al.reversed_at IS NULL) a ON true
        WHERE n.broken_at IS NOT NULL AND ${inPeriod('n.broken_at')} AND ${filters}
        ORDER BY n.broken_at DESC`,
      params,
    );
    const [c] = await this.ds.query(
      `SELECT count(*)::int AS completed FROM negotiations n ${scope}
        WHERE n.status = 'COMPLETED' AND n.completed_at IS NOT NULL AND ${inPeriod('n.completed_at')} AND ${filters}`,
      params,
    );
    return { rows, completed: c.completed };
  }

  disputes(f: { from: string; to: string; organizationId?: number | null; status?: string | null; includeOpenBefore?: boolean }): Promise<DisputeRow[]> {
    return this.ds.query(
      `SELECT x.id, i.id AS "invoiceId", i.reference_number AS reference, d.name AS "debtorName", o.name AS "organizationName", ag.full_name AS "agentName",
              x.original_amount::text AS "originalAmount", x.adjusted_amount::text AS "adjustedAmount", x.reason, x.status, x.outcome,
              x.opened_at AS "openedAt", ob.full_name AS "openedByName", x.resolved_at AS "resolvedAt", rb.full_name AS "resolvedByName",
              x.resolution_notes AS "resolutionNotes",
              (COALESCE(x.resolved_at, now())::date - x.opened_at::date)::int AS days
         FROM invoice_disputes x
         JOIN invoices i ON i.id = x.invoice_id
         JOIN debtors d ON d.id = i.debtor_id
         JOIN organizations o ON o.id = d.organization_id
         LEFT JOIN process_invoices pi ON pi.invoice_id = i.id
         LEFT JOIN process_assignments pa ON pa.process_id = COALESCE(x.process_id, pi.process_id)
         LEFT JOIN users ag ON ag.id = pa.user_id
         LEFT JOIN users ob ON ob.id = x.opened_by_id
         LEFT JOIN users rb ON rb.id = x.resolved_by_id
        WHERE ((x.opened_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Luanda') AND x.opened_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda'))
               OR (x.resolved_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Luanda') AND x.resolved_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda'))
               OR ($5::boolean AND x.status = 'OPEN'))
          AND ($3::int IS NULL OR d.organization_id = $3) AND ($4::text IS NULL OR x.status = $4)
        ORDER BY x.opened_at DESC`,
      [f.from, f.to, f.organizationId ?? null, f.status ?? null, f.includeOpenBefore ?? true],
    );
  }

  async currencySymbol(code: string): Promise<string> {
    const [r] = await this.ds.query('SELECT symbol FROM currencies WHERE code = $1', [code]);
    return r?.symbol ?? code;
  }

  async names(ids: { organizationId?: number | null; agentId?: number | null; contactTypeId?: number | null }) {
    const [r] = await this.ds.query(
      `SELECT (SELECT name FROM organizations WHERE id = $1) AS org, (SELECT coalesce(full_name, email) FROM users WHERE id = $2) AS agent,
              (SELECT name FROM contact_types WHERE id = $3) AS "contactType"`,
      [ids.organizationId ?? null, ids.agentId ?? null, ids.contactTypeId ?? null],
    );
    return r as { org: string | null; agent: string | null; contactType: string | null };
  }
}
