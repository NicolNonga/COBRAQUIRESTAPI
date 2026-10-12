import { mkdirSync, writeFileSync } from 'node:fs';
import { agingPdf, brokenPdf, cashFlowPdf, contactsPdf, disputesPdf, kpiPdf } from './report-pdfs';

const ctx = { generatedBy: 'Administrador', filters: [['Credor', 'Todos'], ['Período', '01/07/2026 a 30/09/2026']] as Array<[string, string]> };
const currency = { code: 'AOA', symbol: 'Kz' };
const period = { from: '2026-07-01', to: '2026-09-30' };
const save = (name: string, pdf: Buffer) => {
  expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  if (process.env.SAVE_PDF_DIR) {
    mkdirSync(process.env.SAVE_PDF_DIR, { recursive: true });
    writeFileSync(`${process.env.SAVE_PDF_DIR}/${name}.pdf`, pdf);
  }
};

describe('report-pdfs (dados de exemplo)', () => {
  it('kpis', () => {
    const k: any = {
      currency, period: { ...period, days: 92 }, dso: 118, cei: 41.2, costToCollect: 12.4, sales: 48_500_000, salesCount: 212, recovered: 19_300_000, recoveredCount: 97,
      costs: 2_390_000, commissions: 1_930_000, costPerPayment: 24_639, margin: -460_000,
      receivable: { end: 62_400_000, overdue: 31_200_000, currentNotDue: 31_200_000 },
      delinquency: { rate: 31.5, overdueCount: 58, maturedCount: 150, countRate: 38.6, lossAmount: 9_800_000, lossRate: 15.7, lossCount: 21, lossThresholdDays: 90 },
      aging: {
        totalOutstanding: 62_400_000, invoices: 140, overduePct: 50,
        buckets: [
          { key: 'CURRENT', label: 'A vencer', amount: 31_200_000, count: 60, pct: 50 },
          { key: 'D1_30', label: '1–30 dias', amount: 9_000_000, count: 25, pct: 14.4 },
          { key: 'D31_60', label: '31–60 dias', amount: 7_400_000, count: 18, pct: 11.9 },
          { key: 'D61_90', label: '61–90 dias', amount: 5_000_000, count: 16, pct: 8 },
          { key: 'D91_180', label: '91–180 dias', amount: 6_800_000, count: 14, pct: 10.9 },
          { key: 'D180_PLUS', label: 'Mais de 180 dias', amount: 3_000_000, count: 7, pct: 4.8 },
        ],
      },
      trend: ['abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.'].map((label, i) => ({
        month: `2026-0${i + 4}`, label, partial: i === 5, receivable: 40_000_000 + i * 4_000_000, sales: 7_000_000 + i * 900_000, recovered: 4_000_000 - i * 150_000 + (i % 2) * 900_000, dso: 90 + i * 5, cei: 60 - i * 3, costToCollect: 8 + i,
      })),
    };
    save('kpis', kpiPdf(k, ctx));
    save('kpis-vazio', kpiPdf({ ...k, dso: null, cei: null, costToCollect: null, delinquency: { ...k.delinquency, rate: null, lossAmount: 0, lossRate: null }, trend: [] }, ctx));
  });

  const debtors = Array.from({ length: 12 }, (_, i) => ({ debtorId: i + 1, debtorName: `Devedor Exemplo ${i + 1}, Lda`, organizationName: i % 2 ? 'Banco Atlântico' : 'Unitel', invoices: 3, outstanding: 9_000_000 - i * 600_000, maxDays: 140 - i * 12 }));
  it('aging', () => {
    const a: any = {
      asOf: '2026-10-07', currency, totalOutstanding: 62_400_000, filteredOutstanding: 62_400_000, truncated: false,
      buckets: [
        { key: 'CURRENT', label: 'A vencer', amount: 31_200_000, count: 60, pct: 50 },
        { key: 'D1_30', label: '1–30 dias', amount: 9_000_000, count: 25, pct: 14.4 },
        { key: 'D31_60', label: '31–60 dias', amount: 7_400_000, count: 18, pct: 11.9 },
        { key: 'D61_90', label: '61–90 dias', amount: 5_000_000, count: 16, pct: 8 },
        { key: 'D91_180', label: '91–180 dias', amount: 6_800_000, count: 14, pct: 10.9 },
        { key: 'D180_PLUS', label: 'Mais de 180 dias', amount: 3_000_000, count: 7, pct: 4.8 },
      ],
      debtors,
      rows: debtors.flatMap((d) => [1, 2, 3].map((n) => ({ debtorId: d.debtorId, nif: '5417012345', reference: `FT-${d.debtorId}${n}`, issueDate: '2026-05-10', dueDate: '2026-06-10', daysOverdue: d.maxDays - n * 10, bucket: d.maxDays > 90 ? 'D91_180' : 'D31_60', bucketLabel: d.maxDays > 90 ? '91–180 dias' : '31–60 dias', situation: n === 1 ? 'Em disputa' : 'Em cobrança', agentName: 'João Conceição', amount: 3_000_000, outstanding: 3_000_000 - d.debtorId * 200_000 }))),
    };
    save('aging', agingPdf(a, ctx));
  });

  it('fluxo de caixa', () => {
    const p = (label: string, i: number) => ({ label, agreements: 1_200_000 + i * 100_000, invoices: 800_000, pending: i === 1 ? 300_000 : 0, nominal: 2_300_000 + i * 100_000, probable: 1_600_000 + i * 60_000, cumulative: 1_600_000 * (i + 1) });
    const c: any = {
      asOf: '2026-10-07', currency, granularity: 'week', rates: { installment: 0.72, invoice: 0.64 },
      totals: { agreements: 14_000_000, invoices: 9_600_000, pending: 300_000, pendingCount: 2, nominal: 28_000_000, probable: 17_900_000 },
      overdue: { ...p('Em atraso', 0), nominal: 6_000_000, probable: 2_900_000 },
      periods: Array.from({ length: 12 }, (_, i) => p(`${String(7 + i * 7).padStart(2, '0')}/10 – ${String(13 + i * 7).padStart(2, '0')}/10`, i)),
      installments: [{ dueDate: '2026-10-12', debtorName: 'Devedor Exemplo 1, Lda', organizationName: 'Unitel', negotiationId: 12, number: 2, of: 6, agentName: 'Ana', remaining: 450_000, status: 'OVERDUE' }],
      upcomingInvoices: [{ dueDate: '2026-10-20', reference: 'FT-90', debtorName: 'Devedor Exemplo 2, Lda', organizationName: 'Unitel', agentName: null, outstanding: 1_000_000 }],
    };
    save('fluxo', cashFlowPdf(c, ctx));
  });

  it('contactos', () => {
    const c: any = {
      period, total: 420, debtorsContacted: 133, reachRate: 38.1, negotiationsStarted: 32, truncated: false,
      byStatus: [{ key: 'negotiation_started', label: 'Negociação iniciada', count: 32 }, { key: 'answered', label: 'Atendido', count: 128 }, { key: 'no_answer', label: 'Sem resposta', count: 190 }, { key: 'failed', label: 'Falhou', count: 70 }],
      byAgent: [{ agentName: 'Ana Silva', total: 200, debtors: 70, reached: 100, reachRate: 50, negotiations: 20, failed: 60, avgDurationSeconds: 184 }, { agentName: 'João Conceição', total: 220, debtors: 80, reached: 60, reachRate: 27.3, negotiations: 12, failed: 200, avgDurationSeconds: 95 }],
      rows: Array.from({ length: 30 }, (_, i) => ({ contactedAt: '2026-09-10T10:00:00Z', agentName: 'Ana Silva', debtorName: `Devedor ${i}`, organizationName: 'Unitel', processId: i + 1, type: 'Chamada', status: i % 3 ? 'answered' : 'no_answer', statusLabel: i % 3 ? 'Atendido' : 'Sem resposta', durationSeconds: 120, notes: 'Prometeu pagar na próxima semana' })),
    };
    save('contactos', contactsPdf(c, ctx));
  });

  it('acordos quebrados', () => {
    const b: any = {
      currency, period, count: 14, automatic: 11, breakRate: 28.6, completed: 35, missing: 8_400_000, agreed: 21_000_000, paid: 6_300_000, renegotiated: 4,
      byAgent: [{ agentName: 'Ana Silva', count: 3, missing: 1_900_000 }, { agentName: 'João Conceição', count: 8, missing: 5_500_000 }, { agentName: 'Pedro', count: 3, missing: 1_000_000 }],
      rows: Array.from({ length: 14 }, (_, i) => ({ id: i + 1, debtorName: `Devedor ${i}`, organizationName: 'Unitel', agentName: 'Ana', startedAt: '2026-07-10T10:00:00Z', brokenAt: '2026-09-10T10:00:00Z', installmentsPaid: 1, installmentsTotal: 6, agreed: 1_500_000, paid: 250_000, missing: 600_000, automatic: i % 3 > 0, brokenByName: 'Admin', breakReason: 'Prestação 2 vencida há 7 dias', renegotiatedId: i % 5 === 0 ? 99 : null })),
    };
    save('quebrados', brokenPdf(b, ctx));
  });

  it('disputas', () => {
    const d: any = {
      currency, period, opened: 18, openNow: 5, openAmount: 4_200_000, oldestOpenDays: 52, resolvedInPeriod: 13, avgResolutionDays: 9.5, cancelledAmount: 2_100_000, adjustedReduction: 600_000,
      outcomes: [{ key: 'CANCELLED', count: 4, amount: 2_100_000 }, { key: 'ADJUSTED', count: 3, amount: 1_800_000 }, { key: 'UPHELD', count: 6, amount: 5_000_000 }],
      rows: Array.from({ length: 10 }, (_, i) => ({ reference: `FT-${i}`, debtorName: `Devedor ${i}`, organizationName: 'Unitel', originalAmount: 900_000, reason: 'Valor facturado diferente do contratado', openedAt: '2026-08-01T10:00:00Z', openedByName: 'Ana', status: i % 2 ? 'OPEN' : 'RESOLVED', outcome: i % 2 ? null : 'CANCELLED', adjustedAmount: null, resolvedAt: '2026-08-12T10:00:00Z', days: 11 + i * 6 })),
    };
    save('disputas', disputesPdf(d, ctx));
  });
});
