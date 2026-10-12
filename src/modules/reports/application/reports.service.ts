import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ValidationError } from '@/shared/domain/errors';
import {
  AGING_BUCKETS, AgingBucket, bucketLabel, bucketOf, cei, CONTACT_STATUS_LABEL, costToCollect, dso, LOSS_THRESHOLD_DAYS, pct,
} from '../domain/kpi-formulas';
import { SqlReportQueries } from '../infrastructure/sql-report.queries';

export interface ReportFilter {
  from?: string;
  to?: string;
  organizationId?: number;
  agentId?: number;
}

const MAX_DAYS = 731;
const ROW_LIMIT = 5000;
const n = (v: string | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const luanda = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda' }).format(d);
const addDays = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso: string) => { const d = new Date(`${monthStart(iso)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

@Injectable()
export class ReportsService {
  readonly currency: string;

  constructor(
    private readonly q: SqlReportQueries,
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(ConfigService) cfg: ConfigService,
  ) {
    this.currency = String(cfg.get('BASE_CURRENCY_CODE', 'AOA')).toUpperCase();
  }

  today() {
    return luanda();
  }

  /** período por defeito: últimos 90 dias (até hoje) */
  period(f: ReportFilter, defaultDays = 90) {
    const today = this.today();
    const to = f.to ?? today;
    const from = f.from ?? addDays(to, -(defaultDays - 1));
    if (from > to) throw new ValidationError('A data inicial não pode ser depois da data final');
    if (diffDays(from, to) > MAX_DAYS) throw new ValidationError('O período máximo é de 2 anos');
    return { from, to, days: diffDays(from, to) + 1 };
  }

  async filterLabels(f: { organizationId?: number; agentId?: number; contactTypeId?: number }) {
    return this.q.names(f);
  }

  async symbol() {
    return this.q.currencySymbol(this.currency);
  }

  /* ───────────────────────── Indicadores ───────────────────────── */
  async kpis(f: ReportFilter) {
    const p = this.period(f);
    const org = f.organizationId ?? null;
    const today = this.today();

    // tendência: 6 meses que terminam no mês de "to"
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(`${monthStart(p.to)}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - (5 - i));
      const start = d.toISOString().slice(0, 10);
      const end = monthEnd(start) > today ? today : monthEnd(start);
      return { start, end };
    }).filter((m) => m.start <= today);

    const days = [...new Set([addDays(p.from, -1), p.to, ...months.flatMap((m) => [addDays(m.start, -1), m.end])])];
    const [ar, facts, open, matured, symbol, monthFacts] = await Promise.all([
      this.q.receivableAt(this.currency, days, org),
      this.q.periodFacts(this.currency, p.from, p.to, org),
      this.q.openInvoices(this.currency, { organizationId: org }),
      this.matured(p.from, p.to, org),
      this.symbol(),
      Promise.all(months.map((m) => this.q.periodFacts(this.currency, m.start, m.end, org))),
    ]);
    const arAt = new Map(ar.map((a) => [a.day, { receivable: n(a.receivable), current: Math.min(n(a.currentNotDue), n(a.receivable)) }]));
    const start = arAt.get(addDays(p.from, -1))!;
    const end = arAt.get(p.to)!;

    const sales = n(facts.sales);
    const recovered = n(facts.recovered);
    const costs = this.costs(facts, org);

    // inadimplência: das facturas que venceram no período, quanto continua por pagar hoje
    const overdueInPeriod = open.filter((i) => i.dueDate >= p.from && i.dueDate <= p.to && i.daysOverdue > 0);
    const overdueAmount = overdueInPeriod.reduce((s, i) => s + n(i.outstanding), 0);
    const totalOutstanding = open.reduce((s, i) => s + n(i.outstanding), 0);
    const loss = open.filter((i) => i.daysOverdue > LOSS_THRESHOLD_DAYS);
    const lossAmount = loss.reduce((s, i) => s + n(i.outstanding), 0);

    const aging = this.agingBuckets(open, totalOutstanding);

    const trend = months.map((m, i) => {
      const s = arAt.get(addDays(m.start, -1))!;
      const e = arAt.get(m.end)!;
      const mf = monthFacts[i];
      const mDays = diffDays(m.start, m.end) + 1;
      return {
        month: m.start.slice(0, 7), label: monthLabel(m.start), partial: m.end < monthEnd(m.start),
        receivable: r2(e.receivable), sales: n(mf.sales), recovered: n(mf.recovered),
        dso: dso(e.receivable, n(mf.sales), mDays), cei: cei(s.receivable, n(mf.sales), e.receivable, e.current),
        costToCollect: costToCollect(this.costs(mf, org), n(mf.recovered)),
      };
    });

    return {
      period: p,
      currency: { code: this.currency, symbol },
      receivable: { start: r2(start.receivable), end: r2(end.receivable), currentNotDue: r2(end.current), overdue: r2(Math.max(0, end.receivable - end.current)) },
      sales, salesCount: facts.salesCount, recovered, recoveredCount: facts.recoveredCount, commissions: n(facts.commissions), costs: r2(costs),
      dso: dso(end.receivable, sales, p.days),
      cei: cei(start.receivable, sales, end.receivable, end.current),
      delinquency: {
        rate: pct(overdueAmount, matured.amount),
        countRate: pct(overdueInPeriod.length, matured.count),
        overdueAmount: r2(overdueAmount), overdueCount: overdueInPeriod.length,
        maturedAmount: matured.amount, maturedCount: matured.count,
        lossAmount: r2(lossAmount), lossCount: loss.length, lossRate: pct(lossAmount, totalOutstanding), lossThresholdDays: LOSS_THRESHOLD_DAYS,
      },
      costToCollect: costToCollect(costs, recovered),
      costPerPayment: facts.recoveredCount ? r2(costs / facts.recoveredCount) : null,
      margin: r2(n(facts.commissions) - costs),
      aging: { totalOutstanding: r2(totalOutstanding), invoices: open.length, buckets: aging, overduePct: pct(totalOutstanding - (aging.find((b) => b.key === 'CURRENT')?.amount ?? 0), totalOutstanding) },
      trend,
    };
  }

  /** com filtro de credor, os custos gerais repartem-se pelo peso do credor no valor recuperado */
  private costs(f: { costsOrg: string; costsGeneral: string; recovered: string; recoveredAll: string }, org: number | null) {
    if (!org) return n(f.costsOrg) + n(f.costsGeneral);
    const share = n(f.recoveredAll) > 0 ? n(f.recovered) / n(f.recoveredAll) : 0;
    return n(f.costsOrg) + n(f.costsGeneral) * share;
  }

  private async matured(from: string, to: string, org: number | null) {
    const [r] = await this.ds.query(
      `SELECT COALESCE(sum(i.amount), 0)::numeric(18,2)::text AS amount, count(*)::int AS count
         FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id JOIN debtors d ON d.id = i.debtor_id
        WHERE i.currency_id = (SELECT id FROM currencies WHERE code = $1) AND s.code <> 'CANCELLED'
          AND i.due_date BETWEEN $2 AND LEAST($3::date, (now() AT TIME ZONE 'Africa/Luanda')::date - 1)
          AND ($4::int IS NULL OR d.organization_id = $4)`,
      [this.currency, from, to, org],
    );
    return { amount: n(r.amount), count: r.count as number };
  }

  private agingBuckets(rows: Array<{ outstanding: string; daysOverdue: number }>, total: number) {
    return AGING_BUCKETS.map((b) => {
      const inB = rows.filter((r) => bucketOf(r.daysOverdue) === b.key);
      const amount = inB.reduce((s, r) => s + n(r.outstanding), 0);
      return { key: b.key, label: b.label, amount: r2(amount), count: inB.length, pct: pct(amount, total) ?? 0 };
    });
  }

  /* ───────────────────────── Aging detalhado ───────────────────────── */
  async aging(f: ReportFilter & { bucket?: AgingBucket; search?: string }) {
    const all = await this.q.openInvoices(this.currency, f);
    const total = all.reduce((s, i) => s + n(i.outstanding), 0);
    const s = f.search?.trim().toLowerCase();
    const rows = all
      .map((i) => ({ ...i, bucket: bucketOf(i.daysOverdue), bucketLabel: bucketLabel(bucketOf(i.daysOverdue)), situation: this.situation(i.state, i.negotiationStatus) }))
      .filter((i) => !f.bucket || i.bucket === f.bucket)
      .filter((i) => !s || i.debtorName.toLowerCase().includes(s) || i.reference.toLowerCase().includes(s) || (i.nif ?? '').toLowerCase().includes(s));
    const byDebtor = new Map<number, { debtorId: number; debtorName: string; organizationName: string; invoices: number; outstanding: number; maxDays: number }>();
    for (const i of rows) {
      const d = byDebtor.get(i.debtorId) ?? { debtorId: i.debtorId, debtorName: i.debtorName, organizationName: i.organizationName, invoices: 0, outstanding: 0, maxDays: -99999 };
      d.invoices += 1; d.outstanding += n(i.outstanding); d.maxDays = Math.max(d.maxDays, i.daysOverdue);
      byDebtor.set(i.debtorId, d);
    }
    return {
      asOf: this.today(),
      currency: { code: this.currency, symbol: await this.symbol() },
      totalOutstanding: r2(total),
      buckets: this.agingBuckets(all, total),
      filteredOutstanding: r2(rows.reduce((a, i) => a + n(i.outstanding), 0)),
      debtors: [...byDebtor.values()].map((d) => ({ ...d, outstanding: r2(d.outstanding) })).sort((a, b) => b.outstanding - a.outstanding),
      rows: rows.slice(0, ROW_LIMIT),
      truncated: rows.length > ROW_LIMIT,
    };
  }

  private situation(state: string, neg: string | null) {
    if (state === 'IN_DISPUTE') return 'Em disputa';
    if (neg === 'ACTIVE') return 'Acordo em vigor';
    if (neg === 'PENDING_APPROVAL') return 'Acordo por aprovar';
    if (neg === 'BROKEN') return 'Acordo quebrado';
    if (state === 'PARTIALLY_PAID') return 'Pago parcialmente';
    return state === 'PENDING' ? 'A vencer' : 'Em cobrança';
  }

  /* ───────────────────────── Projecção de fluxo de caixa ───────────────────────── */
  async cashFlow(f: ReportFilter & { granularity?: 'week' | 'month'; periods?: number }) {
    const today = this.today();
    const gran = f.granularity ?? 'week';
    const count = Math.min(Math.max(f.periods ?? (gran === 'week' ? 12 : 6), 1), gran === 'week' ? 26 : 12);
    const periods: Array<{ key: string; label: string; start: string; end: string }> = [];
    let cursor = today;
    for (let i = 0; i < count; i++) {
      const end = gran === 'week' ? addDays(cursor, 6) : monthEnd(cursor);
      periods.push({ key: cursor, label: gran === 'week' ? `${ddmm(cursor)} – ${ddmm(end)}` : monthLabel(cursor), start: cursor, end });
      cursor = addDays(end, 1);
    }
    const until = periods[periods.length - 1].end;
    const org = f.organizationId ?? null;
    const [installments, open, pending, rates, symbol] = await Promise.all([
      this.q.openInstallments(until, f),
      this.q.openInvoices(this.currency, f),
      this.q.pendingPayments(org),
      this.q.historicalRates(this.currency, org),
      this.symbol(),
    ]);
    const instRate = rates.installmentRate !== null ? n(rates.installmentRate) : null;
    const invRate = rates.invoiceRate !== null ? n(rates.invoiceRate) : null;
    // facturas sem acordo em vigor, ainda por vencer, fora de disputa
    const upcoming = open.filter((i) => i.dueDate >= today && i.dueDate <= until && i.state !== 'IN_DISPUTE' && !['ACTIVE', 'PENDING_APPROVAL'].includes(i.negotiationStatus ?? ''));

    const row = (label: string, start: string | null, end: string | null) => ({ label, start, end, agreements: 0, invoices: 0, pending: 0, nominal: 0, probable: 0, cumulative: 0 });
    const overdue = row('Prestações em atraso', null, addDays(today, -1));
    const rows = periods.map((p) => row(p.label, p.start, p.end));
    const find = (date: string) => rows.find((r) => date >= r.start! && date <= r.end!);

    for (const it of installments) {
      const target = it.dueDate < today ? overdue : find(it.dueDate);
      if (!target) continue;
      const v = n(it.remaining);
      target.agreements += v;
      // em atraso: metade da taxa histórica (o atraso reduz a probabilidade)
      target.probable += v * (instRate ?? 1) * (it.dueDate < today ? 0.5 : 1);
    }
    for (const i of upcoming) {
      const target = find(i.dueDate);
      if (!target) continue;
      target.invoices += n(i.outstanding);
      target.probable += n(i.outstanding) * (invRate ?? 1);
    }
    rows[0].pending = n(pending.amount);
    rows[0].probable += n(pending.amount);

    let acc = 0;
    for (const r of [overdue, ...rows]) {
      r.nominal = r2(r.agreements + r.invoices + r.pending);
      r.agreements = r2(r.agreements); r.invoices = r2(r.invoices); r.pending = r2(r.pending); r.probable = r2(r.probable);
      acc += r.probable;
      r.cumulative = r2(acc);
    }
    const sum = (k: 'nominal' | 'probable' | 'agreements' | 'invoices' | 'pending') => r2([overdue, ...rows].reduce((s, r) => s + r[k], 0));
    return {
      asOf: today, granularity: gran, currency: { code: this.currency, symbol },
      rates: { installment: instRate, invoice: invRate },
      totals: { nominal: sum('nominal'), probable: sum('probable'), agreements: sum('agreements'), invoices: sum('invoices'), pending: sum('pending'), pendingCount: pending.count },
      overdue, periods: rows,
      installments: installments.slice(0, ROW_LIMIT),
      upcomingInvoices: upcoming.slice(0, ROW_LIMIT).map((i) => ({ id: i.id, reference: i.reference, debtorName: i.debtorName, organizationName: i.organizationName, dueDate: i.dueDate, outstanding: i.outstanding, agentName: i.agentName })),
    };
  }

  /* ───────────────────────── Histórico de contactos ───────────────────────── */
  async contacts(f: ReportFilter & { status?: string; contactTypeId?: number }) {
    const p = this.period(f, 30);
    const rows = await this.q.contacts({ ...p, ...f, from: p.from, to: p.to }, ROW_LIMIT + 1);
    const truncated = rows.length > ROW_LIMIT;
    const list = rows.slice(0, ROW_LIMIT);
    const reached = (s: string) => s === 'answered' || s === 'negotiation_started';
    const byStatus = Object.keys(CONTACT_STATUS_LABEL)
      .map((k) => ({ key: k, label: CONTACT_STATUS_LABEL[k], count: list.filter((c) => c.status === k).length }))
      .filter((s) => s.count > 0);
    const agents = new Map<string, { agentName: string; total: number; reached: number; negotiations: number; failed: number; duration: number; withDuration: number; debtors: Set<string> }>();
    const types = new Map<string, number>();
    for (const c of list) {
      const key = String(c.agentId);
      const a = agents.get(key) ?? { agentName: c.agentName ?? '—', total: 0, reached: 0, negotiations: 0, failed: 0, duration: 0, withDuration: 0, debtors: new Set() };
      a.total += 1;
      if (reached(c.status)) a.reached += 1;
      if (c.status === 'negotiation_started') a.negotiations += 1;
      if (c.status === 'no_answer' || c.status === 'failed') a.failed += 1;
      if (c.durationSeconds) { a.duration += c.durationSeconds; a.withDuration += 1; }
      a.debtors.add(c.debtorName);
      agents.set(key, a);
      types.set(c.type, (types.get(c.type) ?? 0) + 1);
    }
    return {
      period: p,
      total: list.length,
      reached: list.filter((c) => reached(c.status)).length,
      reachRate: pct(list.filter((c) => reached(c.status)).length, list.length),
      negotiationsStarted: list.filter((c) => c.status === 'negotiation_started').length,
      debtorsContacted: new Set(list.map((c) => c.debtorName)).size,
      byStatus,
      byType: [...types.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      byAgent: [...agents.values()]
        .map((a) => ({ agentName: a.agentName, total: a.total, reached: a.reached, negotiations: a.negotiations, failed: a.failed, debtors: a.debtors.size,
          reachRate: pct(a.reached, a.total), avgDurationSeconds: a.withDuration ? Math.round(a.duration / a.withDuration) : null }))
        .sort((a, b) => b.total - a.total),
      rows: list.map((c) => ({ ...c, statusLabel: CONTACT_STATUS_LABEL[c.status] ?? c.status })),
      truncated,
    };
  }

  /* ───────────────────────── Acordos quebrados ───────────────────────── */
  async brokenAgreements(f: ReportFilter) {
    const p = this.period(f);
    const [{ rows, completed }, symbol] = await Promise.all([this.q.brokenAgreements({ ...f, ...p }), this.symbol()]);
    const byAgent = new Map<string, { agentName: string; count: number; missing: number }>();
    for (const r of rows) {
      const k = r.agentName ?? '—';
      const a = byAgent.get(k) ?? { agentName: k, count: 0, missing: 0 };
      a.count += 1; a.missing += n(r.missing);
      byAgent.set(k, a);
    }
    return {
      period: p, currency: { code: this.currency, symbol },
      count: rows.length, completed,
      breakRate: pct(rows.length, rows.length + completed),
      agreed: r2(rows.reduce((s, r) => s + n(r.agreed), 0)),
      paid: r2(rows.reduce((s, r) => s + n(r.paid), 0)),
      missing: r2(rows.reduce((s, r) => s + n(r.missing), 0)),
      automatic: rows.filter((r) => r.automatic).length,
      renegotiated: rows.filter((r) => r.renegotiatedId).length,
      byAgent: [...byAgent.values()].map((a) => ({ ...a, missing: r2(a.missing) })).sort((a, b) => b.count - a.count),
      rows,
    };
  }

  /* ───────────────────────── Disputas ───────────────────────── */
  async disputes(f: ReportFilter & { status?: 'OPEN' | 'RESOLVED'; includeOpenBefore?: boolean }) {
    const p = this.period(f);
    const [rows, symbol] = await Promise.all([this.q.disputes({ ...f, ...p }), this.symbol()]);
    const inPeriod = (iso: string | null) => !!iso && luanda(new Date(iso)) >= p.from && luanda(new Date(iso)) <= p.to;
    const resolved = rows.filter((r) => r.status === 'RESOLVED');
    const outcomes = ['UPHELD', 'CANCELLED', 'ADJUSTED'].map((k) => ({
      key: k, count: resolved.filter((r) => r.outcome === k).length,
      amount: r2(resolved.filter((r) => r.outcome === k).reduce((s, r) => s + n(r.originalAmount), 0)),
    }));
    const open = rows.filter((r) => r.status === 'OPEN');
    return {
      period: p, currency: { code: this.currency, symbol },
      opened: rows.filter((r) => inPeriod(r.openedAt)).length,
      resolvedInPeriod: resolved.filter((r) => inPeriod(r.resolvedAt)).length,
      openNow: open.length,
      openAmount: r2(open.reduce((s, r) => s + n(r.originalAmount), 0)),
      avgResolutionDays: resolved.length ? Math.round((resolved.reduce((s, r) => s + r.days, 0) / resolved.length) * 10) / 10 : null,
      oldestOpenDays: open.length ? Math.max(...open.map((r) => r.days)) : null,
      cancelledAmount: outcomes.find((o) => o.key === 'CANCELLED')!.amount,
      adjustedReduction: r2(resolved.filter((r) => r.outcome === 'ADJUSTED').reduce((s, r) => s + n(r.originalAmount) - n(r.adjustedAmount), 0)),
      outcomes,
      rows,
    };
  }
}
