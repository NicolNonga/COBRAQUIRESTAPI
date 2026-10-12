import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { teamScopeSql } from '@/infrastructure/database/team-scope.sql';
import { AgentFacts, CreditorFacts, DashboardFacts, DashboardFilter, DashboardQueries, MonthlyFacts } from '../domain/dashboard.port';

/** limites do período em timestamptz (calendário de Luanda) → usa índices em start_date */
const FROM_TS = `($1::date::timestamp AT TIME ZONE 'Africa/Luanda')`;
const TO_TS = `(($2::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda')`;
const IN_PERIOD = (col: string) => `(${col} >= ${FROM_TS} AND ${col} < ${TO_TS})`;

type GroupKey = 'agent' | 'creditor' | 'total';

const METRICS = `
  COALESCE(sum(f.in_collection), 0)::numeric(18,2)::text AS "inCollection",
  COALESCE(sum(f.open_processes), 0)::int AS "openProcesses",
  COALESCE(sum(f.placed), 0)::numeric(18,2)::text AS placed,
  COALESCE(sum(f.placed_processes), 0)::int AS "placedProcesses",
  COALESCE(sum(f.recovered), 0)::numeric(18,2)::text AS recovered,
  COALESCE(sum(f.recovered_payments), 0)::int AS "recoveredPayments",
  COALESCE(sum(f.pending), 0)::numeric(18,2)::text AS "pendingConfirmation"`;

/**
 * Um só statement por pedido (sem N+1):
 *  proc  → processos no âmbito (abertos, ou que entraram em cobrança no período) com responsável e credor
 *  inv   → Σ facturas por processo (moeda base)
 *  neg   → em falta do acordo em vigor (final − alocado) — o desconto negociado conta
 *  pay   → pagamentos confirmados no período (+ pendentes), atribuídos ao responsável do processo do acordo
 *  facts → UNION das duas fontes, agregado pela chave pedida
 */
const factsCte = (scope: { procAgent: string; payAgent: string }) => `
  WITH proc AS (
    SELECT pr.id, pa.user_id AS agent_id, d.organization_id AS org_id, pr.closed_at,
           ${IN_PERIOD('pr.start_date')} AS in_period
      FROM processes pr
      JOIN debtors d ON d.id = pr.debtor_id
      LEFT JOIN process_assignments pa ON pa.process_id = pr.id
     WHERE (pr.closed_at IS NULL OR ${IN_PERIOD('pr.start_date')})
       AND ($4::int IS NULL OR pa.user_id = $4) AND ($5::int IS NULL OR d.organization_id = $5)
       AND ${scope.procAgent}
  ), inv AS (
    SELECT pi.process_id, sum(i.amount) AS total
      FROM proc JOIN process_invoices pi ON pi.process_id = proc.id JOIN invoices i ON i.id = pi.invoice_id
     WHERE i.currency_id = (SELECT c.id FROM currencies c WHERE c.code = $3)
     GROUP BY pi.process_id
  ), neg AS (
    SELECT DISTINCT ON (np.process_id) np.process_id,
           n.final_amount - COALESCE((SELECT sum(al.amount) FROM payment_allocations al
                                       WHERE al.negotiation_id = n.id AND al.reversed_at IS NULL), 0) AS remaining
      FROM proc
      JOIN negotiation_processes np ON np.process_id = proc.id AND np.is_active
      JOIN negotiations n ON n.id = np.negotiation_id AND n.status IN ('ACTIVE','PENDING_APPROVAL')
     WHERE proc.closed_at IS NULL
     ORDER BY np.process_id, n.id DESC
  ), pay AS (
    SELECT x.agent_id, p.organization_id AS org_id, p.status, p.amount_base
      FROM payments p
      LEFT JOIN LATERAL (
        SELECT asg.user_id AS agent_id FROM negotiation_processes np JOIN process_assignments asg ON asg.process_id = np.process_id
         WHERE np.negotiation_id = p.negotiation_id ORDER BY np.id DESC LIMIT 1
      ) x ON true
     WHERE ((p.status = 'CONFIRMED' AND p.paid_on BETWEEN $1::date AND $2::date) OR p.status = 'PENDING')
       AND ($4::int IS NULL OR x.agent_id = $4) AND ($5::int IS NULL OR p.organization_id = $5)
       AND ${scope.payAgent}
  ), f AS (
    SELECT proc.agent_id, proc.org_id,
           CASE WHEN proc.closed_at IS NULL THEN GREATEST(COALESCE(neg.remaining, inv.total, 0), 0) ELSE 0 END AS in_collection,
           CASE WHEN proc.closed_at IS NULL THEN 1 ELSE 0 END AS open_processes,
           CASE WHEN proc.in_period THEN COALESCE(inv.total, 0) ELSE 0 END AS placed,
           CASE WHEN proc.in_period THEN 1 ELSE 0 END AS placed_processes,
           0 AS recovered, 0 AS recovered_payments, 0 AS pending
      FROM proc LEFT JOIN inv ON inv.process_id = proc.id LEFT JOIN neg ON neg.process_id = proc.id
    UNION ALL
    SELECT pay.agent_id, pay.org_id, 0, 0, 0, 0,
           CASE WHEN pay.status = 'CONFIRMED' THEN pay.amount_base ELSE 0 END,
           CASE WHEN pay.status = 'CONFIRMED' THEN 1 ELSE 0 END,
           CASE WHEN pay.status = 'PENDING' THEN pay.amount_base ELSE 0 END
      FROM pay
  )`;

@Injectable()
export class SqlDashboardQueries extends BaseTypeOrmRepository implements DashboardQueries {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  private build(f: DashboardFilter) {
    const base: unknown[] = [f.from, f.to, f.baseCurrencyCode, f.agentId ?? null, f.organizationId ?? null];
    const procScope = teamScopeSql('pa.user_id', f.scope, base.length + 1);
    const payScope = teamScopeSql('x.agent_id', f.scope, base.length + 1); // mesmo parâmetro
    return { params: [...base, ...procScope.params], cte: factsCte({ procAgent: procScope.sql, payAgent: payScope.sql }) };
  }

  private query<T>(f: DashboardFilter, key: GroupKey): Promise<T[]> {
    const { params, cte } = this.build(f);
    const sql =
      key === 'total'
        ? `${cte} SELECT ${METRICS} FROM f`
        : key === 'agent'
          ? `${cte} SELECT f.agent_id AS "agentId", u.full_name AS "agentName", ${METRICS}
               FROM f LEFT JOIN users u ON u.id = f.agent_id
              GROUP BY f.agent_id, u.full_name ORDER BY sum(f.recovered) DESC, sum(f.in_collection) DESC`
          : `${cte} SELECT f.org_id AS "organizationId", o.name AS "organizationName", o.commission_rate::text AS "commissionRate", ${METRICS}
               FROM f JOIN organizations o ON o.id = f.org_id
              GROUP BY f.org_id, o.name, o.commission_rate ORDER BY sum(f.recovered) DESC, sum(f.in_collection) DESC`;
    return this.manager.query(sql, params);
  }

  async totals(f: DashboardFilter): Promise<DashboardFacts> {
    const [r] = await this.query<DashboardFacts>(f, 'total');
    return r;
  }

  byAgent(f: DashboardFilter): Promise<AgentFacts[]> {
    return this.query<AgentFacts>(f, 'agent');
  }

  byCreditor(f: DashboardFilter): Promise<CreditorFacts[]> {
    return this.query<CreditorFacts>(f, 'creditor');
  }

  /** série mensal: posto em cobrança (entrada dos processos) e recuperado (data de pagamento) */
  monthly(f: DashboardFilter): Promise<MonthlyFacts[]> {
    const base: unknown[] = [f.from, f.to, f.baseCurrencyCode, f.agentId ?? null, f.organizationId ?? null];
    const procScope = teamScopeSql('pa.user_id', f.scope, base.length + 1);
    const payScope = teamScopeSql('x.agent_id', f.scope, base.length + 1);
    return this.manager.query(
      `WITH placed AS (
         SELECT to_char(pr.start_date AT TIME ZONE 'Africa/Luanda', 'YYYY-MM') AS month, sum(i.amount) AS amount
           FROM processes pr
           JOIN debtors d ON d.id = pr.debtor_id
           LEFT JOIN process_assignments pa ON pa.process_id = pr.id
           JOIN process_invoices pi ON pi.process_id = pr.id
           JOIN invoices i ON i.id = pi.invoice_id AND i.currency_id = (SELECT c.id FROM currencies c WHERE c.code = $3)
          WHERE ${IN_PERIOD('pr.start_date')}
            AND ($4::int IS NULL OR pa.user_id = $4) AND ($5::int IS NULL OR d.organization_id = $5) AND ${procScope.sql}
          GROUP BY 1
       ), recovered AS (
         SELECT to_char(p.paid_on, 'YYYY-MM') AS month, sum(p.amount_base) AS amount
           FROM payments p
           LEFT JOIN LATERAL (
             SELECT asg.user_id AS agent_id FROM negotiation_processes np JOIN process_assignments asg ON asg.process_id = np.process_id
              WHERE np.negotiation_id = p.negotiation_id ORDER BY np.id DESC LIMIT 1
           ) x ON true
          WHERE p.status = 'CONFIRMED' AND p.paid_on BETWEEN $1::date AND $2::date
            AND ($4::int IS NULL OR x.agent_id = $4) AND ($5::int IS NULL OR p.organization_id = $5) AND ${payScope.sql}
          GROUP BY 1
       ), months AS (
         SELECT to_char(m, 'YYYY-MM') AS month FROM generate_series(date_trunc('month', $1::date), date_trunc('month', $2::date), interval '1 month') m
       )
       SELECT months.month, COALESCE(placed.amount, 0)::numeric(18,2)::text AS placed, COALESCE(recovered.amount, 0)::numeric(18,2)::text AS recovered
         FROM months LEFT JOIN placed USING (month) LEFT JOIN recovered USING (month)
        ORDER BY months.month`,
      [...base, ...procScope.params],
    );
  }
}
