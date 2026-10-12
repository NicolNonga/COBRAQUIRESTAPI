import { COLORS, Insight, ReportPdf, Row, Slice, Tone } from '@/infrastructure/pdf/report-pdf';
import { DISPUTE_OUTCOME_LABEL } from '../domain/kpi-formulas';
import type { ReportsService } from './reports.service';

type Kpis = Awaited<ReturnType<ReportsService['kpis']>>;
type Aging = Awaited<ReturnType<ReportsService['aging']>>;
type CashFlow = Awaited<ReturnType<ReportsService['cashFlow']>>;
type Contacts = Awaited<ReturnType<ReportsService['contacts']>>;
type Broken = Awaited<ReturnType<ReportsService['brokenAgreements']>>;
type Disputes = Awaited<ReturnType<ReportsService['disputes']>>;

export interface PdfContext {
  generatedBy: string;
  filters: Array<[string, string]>;
}

/* ───────── formatação pt-AO ───────── */
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const money = (v: number | string | null | undefined, symbol = 'Kz') => {
  const x = Number(v ?? 0);
  const [i, d] = Math.abs(x).toFixed(2).split('.');
  return `${x < 0 ? '−' : ''}${group(i)},${d} ${symbol}`;
};
const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : group(String(Math.round(v))));
const pctS = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(digits).replace('.', ',')}%`);
export const dateS = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const dt = (iso: string | Date | null | undefined) =>
  iso ? new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' }).format(new Date(iso)) : '—';
const d10 = (iso: string | Date | null | undefined) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda' }).format(new Date(iso)) : null);
const duration = (s: number | null) => (s ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : '—');
const periodS = (p: { from: string; to: string }) => `${dateS(p.from)} a ${dateS(p.to)}`;
const dec = (x: number) => x.toFixed(1).replace('.', ',').replace(/,0$/, '');
/** valor compacto para títulos e gráficos: 12,5 M · 340 mil */
const short = (v: number) => {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${dec(a / 1e9)} Mrd`;
  if (a >= 1e6) return `${sign}${dec(a / 1e6)} M`;
  if (a >= 1e3) return `${sign}${dec(a / 1e3)} mil`;
  return `${sign}${Math.round(a)}`;
};
const shortMoney = (v: number, s: string) => `${short(v)} ${s}`;
const ratio = (a: number, b: number) => (b ? (a / b) * 100 : null);
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
const listPt = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

const toneFor = (v: number | null, good: number, bad: number, higherIsBetter = false): Tone => {
  if (v === null) return 'neutral';
  if (higherIsBetter) return v >= good ? 'success' : v <= bad ? 'danger' : 'warning';
  return v <= good ? 'success' : v >= bad ? 'danger' : 'warning';
};
const SEVERITY: Record<Tone, number> = { danger: 0, warning: 1, brand: 2, neutral: 3, success: 4 };
const bySeverity = (xs: Insight[]) => [...xs].sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);

const BUCKET_COLOR: Record<string, string> = { CURRENT: COLORS.g0, D1_30: COLORS.g1, D31_60: COLORS.g2, D61_90: COLORS.g3, D91_180: COLORS.g4, D180_PLUS: COLORS.g5 };
const BUCKET_TONE: Record<string, Tone> = { CURRENT: 'success', D1_30: 'warning', D31_60: 'warning', D61_90: 'warning', D91_180: 'danger', D180_PLUS: 'danger' };
const OVER90 = ['D91_180', 'D180_PLUS'];

/* ───────────────────────── Relatório de Contas a Receber (KPIs) ───────────────────────── */
export function kpiPdf(k: Kpis, ctx: PdfContext): Buffer {
  const s = k.currency.symbol;
  const r = new ReportPdf({
    title: 'Relatório de Contas a Receber',
    subtitle: `Saúde da carteira e eficiência da cobrança · ${periodS(k.period)} (${k.period.days} dias) · valores em ${k.currency.code}`,
    filters: ctx.filters,
    generatedBy: ctx.generatedBy,
    tag: 'CONTAS A RECEBER',
  });

  const dsoT = toneFor(k.dso, 45, 90);
  const inadT = toneFor(k.delinquency.rate, 10, 25);
  const ceiT = toneFor(k.cei, 80, 50, true);
  const custoT = toneFor(k.costToCollect, 10, 25);
  const overduePct = ratio(k.receivable.overdue, k.receivable.end);

  /* 1 · os números que contam */
  r.hero([
    { label: 'Saldo a receber', value: shortMoney(k.receivable.end, s), sub: `Vencido ${shortMoney(k.receivable.overdue, s)} (${pctS(overduePct, 0)} do saldo)`, subTone: toneFor(overduePct, 20, 40) },
    { label: 'Recuperado no período', value: shortMoney(k.recovered, s), sub: `${plural(k.recoveredCount, 'pagamento', 'pagamentos')} · ${pctS(ratio(k.recovered, k.sales), 0)} do facturado`, subTone: 'success' },
    { label: 'Facturado no período', value: shortMoney(k.sales, s), sub: plural(k.salesCount, 'factura emitida', 'facturas emitidas') },
    { label: `Perdas prováveis (> ${k.delinquency.lossThresholdDays} dias)`, value: shortMoney(k.delinquency.lossAmount, s), sub: k.delinquency.lossAmount > 0 ? `${pctS(k.delinquency.lossRate)} do valor em aberto` : 'Sem facturas nessa situação', subTone: k.delinquency.lossAmount > 0 ? 'danger' : 'success' },
  ]);

  /* 2 · veredicto */
  const judged: Array<[string, Tone]> = [['DSO', dsoT], ['inadimplência', inadT], ['CEI', ceiT], ['custo por cobrança', custoT]];
  const scored = judged.filter(([, t]) => t !== 'neutral');
  const SCORE: Partial<Record<Tone, number>> = { success: 100, warning: 55, danger: 10 };
  if (!scored.length) {
    r.verdict('neutral', 'Sem dados suficientes para avaliar', 'Não houve facturação nem cobrança no período e filtros escolhidos. Alargue o período para obter um diagnóstico.');
  } else {
    const avg = scored.reduce((a, [, t]) => a + (SCORE[t] ?? 0), 0) / scored.length;
    const crit = scored.filter(([, t]) => t === 'danger').map(([n]) => n);
    const warn = scored.filter(([, t]) => t === 'warning').map(([n]) => n);
    const okN = scored.filter(([, t]) => t === 'success').length;
    const tone: Tone = avg >= 80 ? 'success' : avg >= 45 ? 'warning' : 'danger';
    const parts = [`${okN} de ${scored.length} indicadores dentro da meta.`];
    if (crit.length) parts.push(`Em zona crítica: ${listPt(crit)}.`);
    if (warn.length) parts.push(`A exigir atenção: ${listPt(warn)}.`);
    r.verdict(tone, tone === 'success' ? 'Carteira saudável' : tone === 'warning' ? 'Carteira a exigir atenção' : 'Carteira em situação crítica', parts.join(' '));
  }

  /* 3 · os quatro indicadores essenciais, com régua de desempenho */
  r.kpis([
    {
      label: 'DSO · prazo médio de recebimento', value: k.dso === null ? '—' : `${num(k.dso)} dias`, tone: dsoT, status: true, target: 'Meta até 45 dias',
      gauge: k.dso === null ? undefined : { value: k.dso, good: 45, bad: 90, max: 135 }, hint: 'Dias de facturação ainda por receber.',
    },
    {
      label: 'Índice de inadimplência', value: pctS(k.delinquency.rate), tone: inadT, status: true, target: 'Meta até 10%',
      gauge: k.delinquency.rate === null ? undefined : { value: k.delinquency.rate, good: 10, bad: 25, max: 50 },
      hint: `${num(k.delinquency.overdueCount)} de ${plural(k.delinquency.maturedCount, 'factura vencida', 'facturas vencidas')} no período por pagar.`,
    },
    {
      label: 'CEI · eficiência da cobrança', value: pctS(k.cei), tone: ceiT, status: true, target: 'Meta mín. 80%',
      gauge: k.cei === null ? undefined : { value: k.cei, good: 80, bad: 50, max: 100, higherIsBetter: true }, hint: 'Do que era cobrável, quanto se cobrou (100% = tudo).',
    },
    {
      label: 'Custo por cobrança', value: pctS(k.costToCollect), tone: custoT, status: true, target: 'Meta até 10%',
      gauge: k.costToCollect === null ? undefined : { value: k.costToCollect, good: 10, bad: 25, max: 50 },
      hint: k.costToCollect === null ? 'Sem valor recuperado no período.' : `Custa ${money(k.costToCollect, s)} recuperar 100 ${s}.`,
    },
  ]);

  /* 4 · o que fazer */
  r.section('Destaques e recomendações', 'O que os números dizem e onde agir primeiro.', 130);
  r.insights(bySeverity(kpiInsights(k, { dsoT, inadT, ceiT, custoT })).slice(0, 6));

  /* 5 · aging */
  const bucketSlices: Slice[] = k.aging.buckets.map((b) => ({ label: b.label, value: b.amount, valueLabel: money(b.amount, s), sub: num(b.count), color: BUCKET_COLOR[b.key] }));
  r.section('Carteira em aberto por faixa de atraso', `${money(k.aging.totalOutstanding, s)} em aberto em ${plural(k.aging.invoices, 'factura', 'facturas')}; ${pctS(k.aging.overduePct)} já venceu.`, 190);
  r.stackedBar(bucketSlices);

  /* 6 · evolução */
  r.section('Evolução mensal', 'Facturado e recuperado em cada mês, com os indicadores correspondentes.', 275);
  if (k.trend.length >= 2) {
    r.columnChart(
      k.trend.map((m) => `${m.label}${m.partial ? '*' : ''}`),
      [
        { name: 'Facturado', color: COLORS.brand, values: k.trend.map((m) => m.sales) },
        { name: 'Recuperado', color: COLORS.g0, values: k.trend.map((m) => m.recovered) },
      ],
      { format: short, unit: `valores em ${s}` },
    );
  }
  r.table(
    [
      { header: 'Mês', width: 1.3 },
      { header: 'Saldo a receber', width: 2, align: 'right' },
      { header: 'Facturado', width: 2, align: 'right' },
      { header: 'Recuperado', width: 2, align: 'right' },
      { header: 'DSO', width: 0.9, align: 'right' },
      { header: 'CEI', width: 0.9, align: 'right' },
      { header: 'Custo', width: 1.1, align: 'right' },
    ],
    k.trend.map((m) => ({
      cells: [`${m.label}${m.partial ? '*' : ''}`, money(m.receivable, s), money(m.sales, s), money(m.recovered, s), m.dso === null ? '—' : `${m.dso} d`, pctS(m.cei), pctS(m.costToCollect)],
      tones: { 4: toneFor(m.dso, 45, 90), 5: toneFor(m.cei, 80, 50, true), 6: toneFor(m.costToCollect, 10, 25) },
    })),
  );
  if (k.trend.some((m) => m.partial)) r.note('* Mês em curso (até hoje).');

  /* 7 · custos */
  r.section('Custos e margem da operação');
  r.table(
    [
      { header: 'Rubrica', width: 3 },
      { header: 'Valor', width: 2, align: 'right' },
    ],
    [
      { cells: ['Custos da operação no período', money(k.costs, s)] },
      { cells: ['Comissões geradas (pagamentos confirmados)', money(k.commissions, s)] },
      { cells: ['Custo médio por pagamento recuperado', k.costPerPayment === null ? '—' : money(k.costPerPayment, s)] },
      { cells: ['Margem (comissões − custos)', money(k.margin, s)], kind: 'total', tones: { 1: k.margin >= 0 ? 'success' : 'danger' } },
    ],
  );

  r.section('Como se calcula');
  r.note('DSO = saldo a receber no fim do período ÷ valor facturado no período × número de dias do período. Meta: até 45 dias; crítico acima de 90.');
  r.note('Índice de inadimplência = valor em aberto das facturas que venceram no período ÷ valor total dessas facturas. Meta: até 10%; crítico acima de 25%. Perdas prováveis = valor em aberto vencido há mais de 90 dias.');
  r.note('CEI = (saldo inicial + facturado − saldo final) ÷ (saldo inicial + facturado − saldo final ainda não vencido) × 100. Meta: a partir de 80%; crítico até 50%.');
  r.note('Custo por cobrança = custos lançados no período ÷ valor recuperado no período × 100. Meta: até 10%; crítico acima de 25%. Com filtro de credor, os custos gerais repartem-se pelo peso do credor no recuperado.');
  r.note('Saldo a receber = facturas emitidas (não anuladas) − pagamentos confirmados − descontos concedidos em acordos. Valor em aberto por factura: com acordo, o que falta do acordo repartido proporcionalmente pelas facturas.');
  return r.finish();
}

function kpiInsights(k: Kpis, t: { dsoT: Tone; inadT: Tone; ceiT: Tone; custoT: Tone }): Insight[] {
  const s = k.currency.symbol;
  const out: Insight[] = [];
  if (k.dso !== null) {
    out.push({
      tone: t.dsoT,
      title: t.dsoT === 'success' ? `DSO de ${num(k.dso)} dias, dentro da meta` : `DSO de ${num(k.dso)} dias, ${t.dsoT === 'danger' ? 'acima do limite crítico de 90' : 'acima da meta de 45'}`,
      text:
        t.dsoT === 'success'
          ? 'A carteira converte-se em dinheiro depressa. Mantenha o ritmo de contacto e a disciplina de facturação.'
          : `Demora-se em média cerca de ${dec(k.dso / 30)} meses a receber o que se factura, o que prende caixa. Reforce o contacto logo após o vencimento e proponha acordos de pagamento a quem já passou dos 30 dias.`,
    });
  }
  if (k.delinquency.rate !== null) {
    out.push({
      tone: t.inadT,
      title: `Inadimplência de ${pctS(k.delinquency.rate)}${t.inadT === 'success' ? ', dentro da meta' : t.inadT === 'danger' ? ', acima do limite crítico de 25%' : ', acima da meta de 10%'}`,
      text: `${plural(k.delinquency.overdueCount, 'factura vencida no período continua', 'facturas vencidas no período continuam')} por pagar, de ${num(k.delinquency.maturedCount)} que venceram. ${
        t.inadT === 'success' ? 'Os devedores estão a cumprir os prazos.' : 'Priorize os devedores com maior valor em aberto e confirme os contactos e canais de cobrança.'
      }`,
    });
  }
  if (k.cei !== null) {
    out.push({
      tone: t.ceiT,
      title: `CEI de ${pctS(k.cei)}${t.ceiT === 'success' ? ', cobrança eficiente' : t.ceiT === 'danger' ? ', cobrança pouco eficiente' : ', margem para melhorar'}`,
      text:
        t.ceiT === 'success'
          ? 'A equipa está a recuperar a maior parte do que era cobrável no período.'
          : `Só ${pctS(k.cei, 0)} do que era cobrável foi recuperado. Reveja a cadência da régua de cobrança (lembretes antes e logo depois do vencimento) e a carga por agente.`,
    });
  }
  if (k.costToCollect === null) {
    out.push({ tone: 'neutral', title: 'Custo por cobrança sem dados', text: 'Não houve valor recuperado no período, por isso o custo por cobrança não pode ser calculado.' });
  } else if (k.costs === 0) {
    out.push({ tone: 'warning', title: 'Não há custos lançados no período', text: 'O custo por cobrança está subestimado. Lance os custos da operação (equipa, SMS, sistemas, advogados) no separador Custos para obter um valor real.' });
  } else {
    out.push({
      tone: t.custoT,
      title: `Custo por cobrança de ${pctS(k.costToCollect)}${t.custoT === 'success' ? ', operação rentável' : ', acima da meta de 10%'}`,
      text: `Cada 100 ${s} recuperados custam ${money(k.costToCollect, s)}. ${k.margin < 0 ? `A operação gerou menos comissões do que custos (margem de ${money(k.margin, s)}).` : `A margem do período é de ${money(k.margin, s)}.`}`,
    });
  }
  if (k.delinquency.lossAmount > 0) {
    const lt = (k.delinquency.lossRate ?? 0) >= 25 ? 'danger' : 'warning';
    out.push({
      tone: lt,
      title: `${shortMoney(k.delinquency.lossAmount, s)} em risco de perda`,
      text: `${plural(k.delinquency.lossCount, 'factura vencida', 'facturas vencidas')} há mais de ${k.delinquency.lossThresholdDays} dias (${pctS(k.delinquency.lossRate)} do valor em aberto). A probabilidade de recuperação cai muito a partir daqui: avalie acordos com desconto, cobrança jurídica e a necessidade de provisão.`,
    });
  } else {
    out.push({ tone: 'success', title: 'Sem facturas vencidas há mais de 90 dias', text: 'Não há valor em risco de perda no momento.' });
  }
  const full = k.trend.filter((m) => !m.partial);
  if (full.length >= 2) {
    const [prev, last] = full.slice(-2);
    const delta = prev.recovered > 0 ? ((last.recovered - prev.recovered) / prev.recovered) * 100 : null;
    if (delta !== null) {
      out.push({
        tone: delta >= 0 ? 'success' : 'warning',
        title: `Recuperação ${delta >= 0 ? 'subiu' : 'caiu'} ${pctS(Math.abs(delta), 0)} em ${last.label.replace(/\.$/, '')}`,
        text: `Foram recuperados ${money(last.recovered, s)} em ${last.label.replace(/\.$/, '')}, contra ${money(prev.recovered, s)} em ${prev.label.replace(/\.$/, '')}.`,
      });
    }
  }
  return out;
}

/* ───────────────────────── Aging list detalhado ───────────────────────── */
export function agingPdf(a: Aging, ctx: PdfContext): Buffer {
  const s = a.currency.symbol;
  const r = new ReportPdf({
    title: 'Aging List detalhado',
    subtitle: `Facturas em aberto à data de ${dateS(a.asOf)}, por devedor e faixa de atraso · valores em ${a.currency.code}`,
    filters: ctx.filters,
    generatedBy: ctx.generatedBy,
    landscape: true,
    tag: 'AGING LIST',
  });

  // com filtros aplicados, os números seguem a selecção (a menos que a lista tenha sido truncada)
  const useRows = !a.truncated && a.filteredOutstanding !== a.totalOutstanding;
  const agg = a.buckets.map((b) => {
    if (!useRows) return { key: b.key, label: b.label, amount: b.amount, count: b.count };
    const inB = a.rows.filter((x) => x.bucket === b.key);
    return { key: b.key, label: b.label, amount: inB.reduce((n, x) => n + Number(x.outstanding), 0), count: inB.length };
  });
  const total = agg.reduce((n, b) => n + b.amount, 0);
  const overdue = agg.filter((b) => b.key !== 'CURRENT').reduce((n, b) => n + b.amount, 0);
  const crit = agg.filter((b) => OVER90.includes(b.key)).reduce((n, b) => n + b.amount, 0);
  const debtorsN = a.debtors.length;
  const top3 = a.debtors.slice(0, 3).reduce((n, d) => n + d.outstanding, 0);
  const top3Pct = ratio(top3, a.filteredOutstanding);

  r.hero([
    { label: 'Total em aberto', value: shortMoney(a.filteredOutstanding, s), sub: useRows ? `${pctS(ratio(a.filteredOutstanding, a.totalOutstanding), 0)} da carteira (${shortMoney(a.totalOutstanding, s)})` : plural(a.rows.length, 'factura', 'facturas') },
    { label: 'Vencido', value: shortMoney(overdue, s), sub: `${pctS(ratio(overdue, total), 1)} do valor em aberto`, subTone: toneFor(ratio(overdue, total), 30, 60) },
    { label: 'Crítico · vencido há mais de 90 dias', value: shortMoney(crit, s), sub: `${pctS(ratio(crit, total), 1)} do valor em aberto`, subTone: toneFor(ratio(crit, total), 10, 25) },
    { label: 'Devedores com valor em aberto', value: num(debtorsN), sub: top3Pct === null ? undefined : `Os 3 maiores concentram ${pctS(top3Pct, 0)}`, subTone: toneFor(top3Pct, 40, 60) },
  ]);

  r.section('Resumo por faixa de atraso', 'Onde está o dinheiro e há quanto tempo está em atraso.', 190);
  r.stackedBar(agg.map((b) => ({ label: b.label, value: b.amount, valueLabel: money(b.amount, s), sub: num(b.count), color: BUCKET_COLOR[b.key] })));


  const ins: Insight[] = [];
  const critPct = ratio(crit, total);
  if (critPct !== null) {
    const ct = toneFor(critPct, 10, 25);
    ins.push({
      tone: ct,
      title: ct === 'success' ? 'Pouco valor em atraso crítico' : `${pctS(critPct, 0)} do valor em aberto está vencido há mais de 90 dias`,
      text: ct === 'success' ? 'A maior parte da carteira em atraso ainda é recuperável com cobrança normal.' : `São ${money(crit, s)} com baixa probabilidade de recuperação. Priorize acordos com desconto, cobrança jurídica ou provisão para estes devedores.`,
    });
  }
  if (top3Pct !== null && debtorsN > 3) {
    const ct = toneFor(top3Pct, 40, 60);
    ins.push({
      tone: ct,
      title: `Os 3 maiores devedores concentram ${pctS(top3Pct, 0)} do valor em aberto`,
      text: ct === 'success' ? 'O risco está repartido por muitos devedores.' : `${a.debtors.slice(0, 3).map((d) => d.debtorName).join(', ')}. Uma carteira concentrada depende de poucas negociações: dê-lhes um agente dedicado e acompanhamento semanal.`,
    });
  }
  const disputed = a.rows.filter((x) => x.situation === 'Em disputa');
  if (disputed.length) {
    ins.push({ tone: 'warning', title: `${plural(disputed.length, 'factura', 'facturas')} em disputa`, text: `${money(disputed.reduce((n, x) => n + Number(x.outstanding), 0), s)} estão bloqueados por contestação. Resolva-as primeiro: enquanto durarem, não se pode cobrar.` });
  }
  if (ins.length) {
    r.section('Destaques e recomendações', undefined, 130);
    r.insights(bySeverity(ins));
  }

  r.section('Maiores devedores', 'Os dez devedores com mais valor em aberto.');
  r.table(
    [
      { header: 'Devedor', width: 3, wrap: true },
      { header: 'Credor', width: 2.2, wrap: true },
      { header: 'Facturas', width: 0.9, align: 'right' },
      { header: 'Maior atraso', width: 1.2, align: 'right' },
      { header: 'Em aberto', width: 1.8, align: 'right' },
      { header: '% do total', width: 1, align: 'right' },
    ],
    a.debtors.slice(0, 10).map((d) => ({
      cells: [d.debtorName, d.organizationName, num(d.invoices), d.maxDays > 0 ? `${num(d.maxDays)} dias` : 'a vencer', money(d.outstanding, s), pctS(ratio(d.outstanding, a.filteredOutstanding), 1)],
      tones: { 3: d.maxDays > 90 ? 'danger' : d.maxDays > 30 ? 'warning' : 'neutral' },
    })),
  );

  r.section('Detalhe por devedor');
  const rows: Row[] = [];
  const byDebtor = new Map<number, typeof a.rows>();
  a.rows.forEach((i) => byDebtor.set(i.debtorId, [...(byDebtor.get(i.debtorId) ?? []), i]));
  for (const d of a.debtors) {
    const items = byDebtor.get(d.debtorId) ?? [];
    if (!items.length) continue;
    rows.push({ cells: [d.debtorName, items[0].nif ? `NIF ${items[0].nif}` : '', d.organizationName], kind: 'group' });
    for (const i of items) {
      rows.push({
        cells: [i.reference, dateS(i.issueDate), dateS(i.dueDate), i.daysOverdue > 0 ? String(i.daysOverdue) : '—', i.bucketLabel, i.situation, i.agentName ?? '—', money(i.amount, s), money(i.outstanding, s)],
        tones: { 3: BUCKET_TONE[i.bucket] === 'danger' ? 'danger' : 'neutral', 4: BUCKET_TONE[i.bucket] },
      });
    }
    rows.push({ cells: [`Subtotal · ${items.length} ${items.length === 1 ? 'factura' : 'facturas'}`, '', '', '', '', '', '', '', money(d.outstanding, s)], kind: 'subtotal' });
  }
  if (rows.length) rows.push({ cells: ['Total', '', '', '', '', '', '', '', money(a.filteredOutstanding, s)], kind: 'total' });
  r.table(
    [
      { header: 'Factura', width: 1.6 },
      { header: 'Emissão', width: 1 },
      { header: 'Vencimento', width: 1 },
      { header: 'Dias', width: 0.6, align: 'right' },
      { header: 'Faixa', width: 1.2 },
      { header: 'Situação', width: 1.4 },
      { header: 'Agente', width: 1.5 },
      { header: 'Valor', width: 1.6, align: 'right' },
      { header: 'Em aberto', width: 1.6, align: 'right' },
    ],
    rows,
  );
  if (a.truncated) r.note('A lista foi limitada às primeiras 5 000 facturas. Use os filtros para reduzir o resultado.');
  return r.finish();
}

/* ───────────────────────── Projecção de fluxo de caixa ───────────────────────── */
export function cashFlowPdf(c: CashFlow, ctx: PdfContext): Buffer {
  const s = c.currency.symbol;
  const r = new ReportPdf({
    title: 'Projecção de Fluxo de Caixa',
    subtitle: `Entradas previstas a partir de ${dateS(c.asOf)}, ${c.granularity === 'week' ? 'por semana' : 'por mês'} · valores em ${c.currency.code}`,
    filters: ctx.filters,
    generatedBy: ctx.generatedBy,
    tag: 'FLUXO DE CAIXA',
  });
  const conf = ratio(c.totals.probable, c.totals.nominal);
  const overdueShare = ratio(c.overdue.nominal, c.totals.nominal);
  r.hero([
    { label: 'Entrada provável', value: shortMoney(c.totals.probable, s), sub: 'Ponderada pelo histórico de cumprimento', subTone: 'success' },
    { label: 'Valor nominal', value: shortMoney(c.totals.nominal, s), sub: 'Tudo o que vence no horizonte' },
    { label: 'Confiança da projecção', value: pctS(conf, 0), sub: 'Provável ÷ nominal', subTone: toneFor(conf, 80, 60, true) },
    { label: 'Já em atraso', value: shortMoney(c.overdue.nominal, s), sub: `${pctS(overdueShare, 0)} do nominal`, subTone: toneFor(overdueShare, 15, 35) },
  ]);

  const ins: Insight[] = [];
  if (conf !== null) {
    const ct = toneFor(conf, 80, 60, true);
    ins.push({
      tone: ct,
      title: `Só ${pctS(conf, 0)} do valor nominal deve entrar`,
      text: ct === 'success' ? 'O histórico de cumprimento é bom: a projecção é próxima do nominal.' : `Com base no que realmente se pagou nos últimos 180 dias, prevê-se receber ${money(c.totals.probable, s)} dos ${money(c.totals.nominal, s)} que vencem. Planeie a tesouraria com o valor provável, não com o nominal.`,
    });
  }
  if (overdueShare !== null && c.overdue.nominal > 0) {
    ins.push({ tone: toneFor(overdueShare, 15, 35), title: `${money(c.overdue.nominal, s)} já deviam ter entrado`, text: 'Prestações e facturas em atraso contam com metade da probabilidade. Contacte estes devedores esta semana para recuperar o fluxo previsto.' });
  }
  const peak = c.periods.reduce((m, p) => (p.probable > m.probable ? p : m), c.periods[0]);
  if (peak && peak.probable > 0) {
    ins.push({ tone: 'brand', title: `Maior entrada prevista: ${peak.label}`, text: `${money(peak.probable, s)} prováveis (${pctS(ratio(peak.probable, c.totals.probable), 0)} do total). Garanta que os acordos desse período estão a ser acompanhados.` });
  }
  if (c.totals.pending > 0) {
    ins.push({ tone: 'warning', title: `${plural(c.totals.pendingCount, 'pagamento registado', 'pagamentos registados')} por confirmar`, text: `${money(c.totals.pending, s)} só entram em caixa depois de confirmados. Confirme-os para antecipar a entrada.` });
  }
  if (ins.length) {
    r.section('Destaques e recomendações', undefined, 130);
    r.insights(bySeverity(ins));
  }

  r.section('Entradas previstas', 'Nominal (o que vence) contra provável (o que historicamente se paga).', 275);
  r.columnChart(
    c.periods.map((p) => p.label.split(' – ')[0]),
    [
      { name: 'Nominal', color: '#9ec9f1', values: c.periods.map((p) => p.nominal) },
      { name: 'Provável', color: COLORS.g0, values: c.periods.map((p) => p.probable) },
    ],
    { format: short, unit: `valores em ${s}` },
  );

  r.section('Entradas por período');
  const rows: Row[] = [c.overdue, ...c.periods].map((p, i) => ({
    cells: [p.label, money(p.agreements, s), money(p.invoices, s), money(p.pending, s), money(p.nominal, s), money(p.probable, s), money(p.cumulative, s)],
    tones: i === 0 && p.nominal > 0 ? { 0: 'danger' } : undefined,
  }));
  rows.push({ cells: ['Total', money(c.totals.agreements, s), money(c.totals.invoices, s), money(c.totals.pending, s), money(c.totals.nominal, s), money(c.totals.probable, s), ''], kind: 'total' });
  r.table(
    [
      { header: 'Período', width: 1.5 },
      { header: 'Acordos', width: 1.5, align: 'right' },
      { header: 'Facturas', width: 1.5, align: 'right' },
      { header: 'A confirmar', width: 1.3, align: 'right' },
      { header: 'Nominal', width: 1.5, align: 'right' },
      { header: 'Provável', width: 1.5, align: 'right' },
      { header: 'Acumulado', width: 1.5, align: 'right' },
    ],
    rows,
    { fontSize: 7.5 },
  );
  r.note(
    `Probabilidades (últimos 180 dias): prestações de acordos ${c.rates.installment === null ? 'sem histórico — usado 100%' : pctS(c.rates.installment * 100)}; facturas pagas até ao vencimento ${
      c.rates.invoice === null ? 'sem histórico — usado 100%' : pctS(c.rates.invoice * 100)
    }. Prestações em atraso contam com metade da probabilidade. Pagamentos a confirmar contam a 100%.`,
  );

  r.section('Prestações de acordos previstas');
  r.table(
    [
      { header: 'Vencimento', width: 1 },
      { header: 'Devedor', width: 2.4 },
      { header: 'Credor', width: 1.8 },
      { header: 'Acordo', width: 0.9 },
      { header: 'Prestação', width: 0.8 },
      { header: 'Agente', width: 1.5 },
      { header: 'Por receber', width: 1.5, align: 'right' },
    ],
    c.installments.map((i) => ({
      cells: [dateS(i.dueDate), i.debtorName, i.organizationName, `#${i.negotiationId}`, i.number ? `${i.number}/${i.of}` : 'À vista', i.agentName ?? '—', money(i.remaining, s)],
      tones: i.status === 'OVERDUE' ? { 0: 'danger' } : undefined,
    })),
    { fontSize: 7.5, emptyText: 'Não há prestações por receber no horizonte.' },
  );
  r.section('Facturas a vencer (sem acordo)');
  r.table(
    [
      { header: 'Vencimento', width: 1 },
      { header: 'Factura', width: 1.4 },
      { header: 'Devedor', width: 2.4 },
      { header: 'Credor', width: 1.8 },
      { header: 'Agente', width: 1.5 },
      { header: 'Em aberto', width: 1.5, align: 'right' },
    ],
    c.upcomingInvoices.map((i) => ({ cells: [dateS(i.dueDate), i.reference, i.debtorName, i.organizationName, i.agentName ?? '—', money(i.outstanding, s)] })),
    { fontSize: 7.5, emptyText: 'Não há facturas a vencer no horizonte.' },
  );
  return r.finish();
}

/* ───────────────────────── Histórico de contactos ───────────────────────── */
const STATUS_COLOR: Record<string, string> = { negotiation_started: COLORS.g0, answered: COLORS.brand, no_answer: COLORS.g2, failed: COLORS.g4 };

export function contactsPdf(c: Contacts, ctx: PdfContext): Buffer {
  const r = new ReportPdf({
    title: 'Histórico de Contactos',
    subtitle: `Contactos registados de ${periodS(c.period)} e eficácia da equipa`,
    filters: ctx.filters,
    generatedBy: ctx.generatedBy,
    landscape: true,
    tag: 'CONTACTOS',
  });
  const failed = c.byStatus.filter((x) => x.key === 'no_answer' || x.key === 'failed').reduce((a, x) => a + x.count, 0);
  const reachT = toneFor(c.reachRate, 50, 25, true);
  const conv = ratio(c.negotiationsStarted, c.total);
  r.hero([
    { label: 'Contactos realizados', value: num(c.total), sub: `${plural(c.debtorsContacted, 'devedor contactado', 'devedores contactados')}` },
    { label: 'Taxa de contacto efectivo', value: pctS(c.reachRate), sub: 'Atendidos ou com negociação iniciada · meta mín. 50%', subTone: reachT },
    { label: 'Negociações iniciadas', value: num(c.negotiationsStarted), sub: `${pctS(conv)} dos contactos`, subTone: 'success' },
    { label: 'Sem resposta / falhados', value: num(failed), sub: `${pctS(ratio(failed, c.total), 0)} dos contactos`, subTone: toneFor(ratio(failed, c.total), 30, 55) },
  ]);

  const ins: Insight[] = [];
  if (c.reachRate !== null) {
    ins.push({
      tone: reachT,
      title: `${pctS(c.reachRate, 0)} dos contactos chegaram ao devedor`,
      text: reachT === 'success' ? 'Boa taxa de contacto efectivo.' : 'A maioria das tentativas não chega ao devedor. Valide telefones e emails, teste outros horários e use SMS ou email como alternativa à chamada.',
    });
  }
  const ranked = c.byAgent.filter((a) => a.total >= 5 && a.reachRate !== null).sort((a, b) => (b.reachRate ?? 0) - (a.reachRate ?? 0));
  if (ranked.length >= 2) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    ins.push({
      tone: 'brand',
      title: `${best.agentName} lidera em contacto efectivo (${pctS(best.reachRate, 0)})`,
      text: `${worst.agentName} está em último com ${pctS(worst.reachRate, 0)}. Vale a pena partilhar as práticas de ${best.agentName} (horários, canal, abordagem) com o resto da equipa.`,
    });
  }
  if (conv !== null && c.total > 0) {
    ins.push({ tone: conv >= 10 ? 'success' : 'warning', title: `${pctS(conv, 1)} dos contactos viram negociação`, text: 'Mede quanto do esforço de contacto se converte em acordo. Acompanhe este número mês a mês para medir o efeito de mudanças de abordagem.' });
  }
  if (ins.length) {
    r.section('Destaques e recomendações', undefined, 130);
    r.insights(bySeverity(ins));
  }

  r.section('Resultado dos contactos', undefined, 190);
  r.donut(
    c.byStatus.map((x, i) => ({ label: x.label, value: x.count, valueLabel: num(x.count), color: STATUS_COLOR[x.key] ?? COLORS.series[(i + 4) % COLORS.series.length] })),
    { centerValue: num(c.total), centerLabel: 'contactos', title: 'RESULTADO', valueTitle: 'CONTACTOS' },
  );

  r.section('Desempenho por agente');
  r.table(
    [
      { header: 'Agente', width: 2.2 },
      { header: 'Contactos', width: 1, align: 'right' },
      { header: 'Devedores', width: 1, align: 'right' },
      { header: 'Efectivos', width: 1, align: 'right' },
      { header: 'Taxa', width: 0.9, align: 'right' },
      { header: 'Negociações', width: 1.1, align: 'right' },
      { header: 'Sem resposta', width: 1.1, align: 'right' },
      { header: 'Duração média', width: 1.2, align: 'right' },
    ],
    c.byAgent.map((a) => ({
      cells: [a.agentName, num(a.total), num(a.debtors), num(a.reached), pctS(a.reachRate), num(a.negotiations), num(a.failed), duration(a.avgDurationSeconds)],
      tones: { 4: toneFor(a.reachRate, 50, 25, true) },
    })),
  );
  r.section('Detalhe');
  r.table(
    [
      { header: 'Data e hora', width: 1.4 },
      { header: 'Agente', width: 1.4 },
      { header: 'Devedor', width: 1.9, wrap: true },
      { header: 'Credor', width: 1.4, wrap: true },
      { header: 'Proc.', width: 0.6 },
      { header: 'Tipo', width: 1 },
      { header: 'Resultado', width: 1.4 },
      { header: 'Duração', width: 0.8, align: 'right' },
      { header: 'Notas', width: 3, wrap: true },
    ],
    c.rows.map((x) => ({
      cells: [dt(x.contactedAt), x.agentName ?? '—', x.debtorName, x.organizationName, `#${x.processId}`, x.type, x.statusLabel, duration(x.durationSeconds), (x.notes ?? '').replace(/\s+/g, ' ')],
      tones: { 6: x.status === 'negotiation_started' || x.status === 'answered' ? 'success' : x.status === 'failed' || x.status === 'no_answer' ? 'danger' : 'neutral' },
    })),
    { fontSize: 7.5 },
  );
  if (c.truncated) r.note('Lista limitada aos 5 000 contactos mais recentes. Reduza o período para ver tudo.');
  return r.finish();
}

/* ───────────────────────── Acordos quebrados ───────────────────────── */
export function brokenPdf(b: Broken, ctx: PdfContext): Buffer {
  const s = b.currency.symbol;
  const r = new ReportPdf({
    title: 'Acordos Quebrados',
    subtitle: `Acordos de pagamento quebrados de ${periodS(b.period)} · valores em ${b.currency.code}`,
    filters: ctx.filters,
    generatedBy: ctx.generatedBy,
    landscape: true,
    tag: 'ACORDOS QUEBRADOS',
  });
  const breakT = toneFor(b.breakRate, 15, 35);
  const paidPct = ratio(b.paid, b.agreed);
  r.hero([
    { label: 'Acordos quebrados', value: num(b.count), sub: `Automáticos ${num(b.automatic)} · manuais ${num(b.count - b.automatic)}`, subTone: b.count ? 'danger' : 'success' },
    { label: 'Taxa de quebra', value: pctS(b.breakRate), sub: `Quebrados ÷ (quebrados + ${num(b.completed)} concluídos) · meta até 15%`, subTone: breakT },
    { label: 'Valor em falta', value: shortMoney(b.missing, s), sub: `De ${shortMoney(b.agreed, s)} acordados`, subTone: b.missing > 0 ? 'warning' : 'success' },
    { label: 'Renegociados', value: num(b.renegotiated), sub: `Pago antes da quebra: ${shortMoney(b.paid, s)}`, subTone: 'brand' },
  ]);

  const ins: Insight[] = [];
  if (b.breakRate !== null) {
    ins.push({
      tone: breakT,
      title: `${pctS(b.breakRate, 0)} dos acordos terminam quebrados`,
      text: breakT === 'success' ? 'A maioria dos acordos é cumprida.' : 'Acordos que se quebram desperdiçam esforço e descontos concedidos. Reveja a capacidade de pagamento antes de fechar o acordo, prefira prestações menores e envie lembretes antes de cada vencimento.',
    });
  }
  if (b.count > 0) {
    const autoPct = ratio(b.automatic, b.count);
    ins.push({
      tone: 'brand',
      title: `${pctS(autoPct, 0)} das quebras foram automáticas`,
      text: 'Quebras automáticas resultam de prestações não pagas dentro da tolerância; as manuais foram decididas por um utilizador. Se as automáticas dominam, o problema é cumprimento do devedor; se as manuais dominam, reveja a política de decisão.',
    });
  }
  if (paidPct !== null && b.agreed > 0) {
    ins.push({ tone: paidPct >= 30 ? 'success' : 'warning', title: `${pctS(paidPct, 0)} do valor acordado foi pago antes da quebra`, text: `Recebeu-se ${money(b.paid, s)} de ${money(b.agreed, s)} acordados; faltam ${money(b.missing, s)}. Os acordos renegociados (${num(b.renegotiated)}) são a via mais rápida de recuperar este saldo.` });
  }
  const topAgent = [...b.byAgent].sort((x, y) => y.missing - x.missing)[0];
  if (topAgent && b.byAgent.length > 1 && b.missing > 0) {
    const share = ratio(topAgent.missing, b.missing);
    if ((share ?? 0) >= 40) ins.push({ tone: 'warning', title: `${topAgent.agentName} concentra ${pctS(share, 0)} do valor em falta`, text: `São ${plural(topAgent.count, 'acordo quebrado', 'acordos quebrados')} com ${money(topAgent.missing, s)} por receber. Reveja estes casos e a carteira atribuída.` });
  }
  if (ins.length) {
    r.section('Destaques e recomendações', undefined, 130);
    r.insights(bySeverity(ins));
  }

  if (b.byAgent.length) {
    r.section('Valor em falta por agente', undefined, 190);
    const sorted = [...b.byAgent].sort((x, y) => y.missing - x.missing);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const slices: Slice[] = top.map((a, i) => ({ label: a.agentName, value: a.missing, valueLabel: money(a.missing, s), color: COLORS.series[i % COLORS.series.length] }));
    if (rest.length) slices.push({ label: `Outros (${rest.length})`, value: rest.reduce((n, a) => n + a.missing, 0), valueLabel: money(rest.reduce((n, a) => n + a.missing, 0), s), color: COLORS.faint });
    r.donut(slices, { centerValue: short(b.missing), centerLabel: `${s} em falta`, title: 'AGENTE', valueTitle: 'VALOR EM FALTA' });
  }
  r.section('Por agente');
  r.table(
    [
      { header: 'Agente', width: 3 },
      { header: 'Acordos quebrados', width: 1.5, align: 'right' },
      { header: 'Valor em falta', width: 2, align: 'right' },
      { header: '% do total em falta', width: 1.5, align: 'right' },
    ],
    b.byAgent.map((a) => ({ cells: [a.agentName, num(a.count), money(a.missing, s), pctS(ratio(a.missing, b.missing), 0)] })),
  );
  r.section('Detalhe');
  r.table(
    [
      { header: 'N.º', width: 0.55 },
      { header: 'Devedor', width: 1.9, wrap: true },
      { header: 'Credor', width: 1.3, wrap: true },
      { header: 'Agente', width: 1.3 },
      { header: 'Início', width: 1.1 },
      { header: 'Quebra', width: 1.1 },
      { header: 'Parc.', width: 0.65, align: 'center' },
      { header: 'Acordado', width: 1.5, align: 'right' },
      { header: 'Pago', width: 1.4, align: 'right' },
      { header: 'Em falta', width: 1.5, align: 'right' },
      { header: 'Motivo', width: 2.8, wrap: true },
      { header: 'Reneg.', width: 0.75 },
    ],
    b.rows.map((x) => ({
      cells: [
        `#${x.id}`,
        x.debtorName,
        x.organizationName,
        x.agentName ?? '—',
        dateS(d10(x.startedAt)),
        dateS(d10(x.brokenAt)),
        `${x.installmentsPaid}/${x.installmentsTotal}`,
        money(x.agreed, s),
        money(x.paid, s),
        money(x.missing, s),
        `${x.automatic ? 'Automática' : `Manual (${x.brokenByName ?? '—'})`}: ${x.breakReason}`,
        x.renegotiatedId ? `#${x.renegotiatedId}` : 'Não',
      ],
      tones: { 9: 'danger', 11: x.renegotiatedId ? 'success' : 'neutral' },
    })),
    { fontSize: 7.2 },
  );
  return r.finish();
}

/* ───────────────────────── Disputas ───────────────────────── */
const OUTCOME_COLOR: Record<string, string> = { CANCELLED: COLORS.g4, ADJUSTED: COLORS.g2, UPHELD: COLORS.g0 };

export function disputesPdf(d: Disputes, ctx: PdfContext): Buffer {
  const s = d.currency.symbol;
  const r = new ReportPdf({
    title: 'Relatório de Disputas e Contestações',
    subtitle: `Disputas abertas ou resolvidas de ${periodS(d.period)} (inclui as que continuam abertas) · valores em ${d.currency.code}`,
    filters: ctx.filters,
    generatedBy: ctx.generatedBy,
    landscape: true,
    tag: 'DISPUTAS',
  });
  const lost = d.cancelledAmount + d.adjustedReduction;
  const oldT = toneFor(d.oldestOpenDays, 15, 45);
  r.hero([
    { label: 'Abertas no período', value: num(d.opened), sub: `${plural(d.resolvedInPeriod, 'resolvida', 'resolvidas')} no período`, subTone: 'brand' },
    { label: 'Em aberto agora', value: num(d.openNow), sub: `${shortMoney(d.openAmount, s)} fora da cobrança${d.oldestOpenDays !== null ? ` · mais antiga: ${d.oldestOpenDays} dias` : ''}`, subTone: d.openNow ? oldT === 'success' ? 'warning' : oldT : 'success' },
    { label: 'Tempo médio de resolução', value: d.avgResolutionDays === null ? '—' : `${dec(d.avgResolutionDays)} dias`, sub: 'Das disputas resolvidas no período', subTone: toneFor(d.avgResolutionDays, 7, 21) },
    { label: 'Valor anulado ou reduzido', value: shortMoney(lost, s), sub: `Anulado ${shortMoney(d.cancelledAmount, s)} · reduzido ${shortMoney(d.adjustedReduction, s)}`, subTone: lost > 0 ? 'danger' : 'success' },
  ]);

  const ins: Insight[] = [];
  if (d.openNow > 0) {
    ins.push({
      tone: d.oldestOpenDays !== null && d.oldestOpenDays > 45 ? 'danger' : 'warning',
      title: `${money(d.openAmount, s)} parados em ${plural(d.openNow, 'disputa aberta', 'disputas abertas')}`,
      text: `Enquanto uma factura está em disputa, não se pode cobrar.${d.oldestOpenDays !== null ? ` A mais antiga aguarda há ${d.oldestOpenDays} dias.` : ''} Defina um prazo máximo de resposta e decida primeiro as de maior valor.`,
    });
  } else {
    ins.push({ tone: 'success', title: 'Nenhuma disputa em aberto', text: 'Todas as contestações foram decididas; a cobrança não tem facturas bloqueadas.' });
  }
  const totalOutcome = d.outcomes.reduce((n, o) => n + o.count, 0);
  const cancelled = d.outcomes.find((o) => o.key === 'CANCELLED');
  if (cancelled && totalOutcome > 0) {
    const sh = ratio(cancelled.count, totalOutcome);
    ins.push({ tone: toneFor(sh, 25, 50), title: `${pctS(sh, 0)} das disputas decididas anularam a factura`, text: `${money(cancelled.amount, s)} de facturação foi anulada. Se este valor for alto, procure a origem (dados de facturação errados, entregas contestadas) e corrija-a na emissão.` });
  }
  if (d.avgResolutionDays !== null) {
    const rt = toneFor(d.avgResolutionDays, 7, 21);
    ins.push({ tone: rt, title: `Disputas resolvem-se em ${dec(d.avgResolutionDays)} dias, em média`, text: rt === 'success' ? 'Resolução rápida: o dinheiro volta depressa à cobrança.' : 'Cada dia de disputa adia a cobrança. Considere alertas para disputas com mais de uma semana e um responsável por decisão.' });
  }
  if (ins.length) {
    r.section('Destaques e recomendações', undefined, 130);
    r.insights(bySeverity(ins));
  }

  r.section('Decisões tomadas', undefined, 190);
  r.donut(
    d.outcomes.map((o, i) => ({ label: DISPUTE_OUTCOME_LABEL[o.key], value: o.count, valueLabel: `${num(o.count)} · ${shortMoney(o.amount, s)}`, color: OUTCOME_COLOR[o.key] ?? COLORS.series[i % COLORS.series.length] })),
    { centerValue: num(totalOutcome), centerLabel: 'decisões', title: 'DECISÃO', valueTitle: 'N.º · VALOR' },
  );
  r.table(
    [
      { header: 'Decisão', width: 3 },
      { header: 'Disputas', width: 1, align: 'right' },
      { header: 'Valor original', width: 2, align: 'right' },
    ],
    d.outcomes.map((o) => ({ cells: [DISPUTE_OUTCOME_LABEL[o.key], num(o.count), money(o.amount, s)] })),
  );
  r.section('Detalhe');
  r.table(
    [
      { header: 'Factura', width: 1.2 },
      { header: 'Devedor', width: 1.8, wrap: true },
      { header: 'Credor', width: 1.3, wrap: true },
      { header: 'Valor', width: 1.4, align: 'right' },
      { header: 'Motivo', width: 2.6, wrap: true },
      { header: 'Aberta', width: 1.1 },
      { header: 'Por', width: 1.2 },
      { header: 'Estado', width: 1.6, wrap: true },
      { header: 'Resolvida', width: 1.1 },
      { header: 'Dias', width: 0.55, align: 'right' },
    ],
    d.rows.map((x) => ({
      cells: [
        x.reference,
        x.debtorName,
        x.organizationName,
        money(x.originalAmount, s),
        x.reason.replace(/\s+/g, ' '),
        dateS(d10(x.openedAt)),
        x.openedByName ?? '—',
        x.status === 'OPEN' ? 'Em aberto' : x.outcome === 'ADJUSTED' ? `Corrigido p/ ${money(x.adjustedAmount, s)}` : (DISPUTE_OUTCOME_LABEL[x.outcome ?? ''] ?? '—'),
        dateS(d10(x.resolvedAt)),
        String(x.days),
      ],
      tones: { 7: x.status === 'OPEN' ? 'warning' : x.outcome === 'CANCELLED' ? 'danger' : 'success', 9: x.status === 'OPEN' && x.days > 45 ? 'danger' : 'neutral' },
    })),
    { fontSize: 7.2 },
  );
  return r.finish();
}
