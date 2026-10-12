import { TableColumn, TablePdf } from '@/infrastructure/pdf/table-pdf';
import { dateS, money } from './report-pdfs';

/**
 * PDF das listagens (facturas, devedores, processos, negociações, pagamentos): a tabela do ecrã,
 * com TODAS as linhas que correspondem aos filtros, em documento sóbrio a preto e branco.
 * Funções puras sobre as linhas que a API já devolve.
 */
export interface ListPdfContext {
  generatedBy: string;
  filters: Array<[string, string]>;
  /** total real quando a listagem foi cortada no limite de linhas */
  total: number;
  truncated: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = any;

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const num = (v: unknown) => group(String(Math.round(Number(v ?? 0) || 0)));
const n = (v: unknown) => Number(v ?? 0) || 0;
const sum = (rows: R[], f: (r: R) => unknown) => rows.reduce((t, r) => t + n(f(r)), 0);
const plural = (c: number, one: string, many: string) => `${num(c)} ${c === 1 ? one : many}`;
const pct = (v: unknown) => `${n(v).toFixed(n(v) % 1 ? 1 : 0).replace('.', ',')}%`;
const code = (prefix: string, id: unknown) => `${prefix}-${String(id ?? '').padStart(5, '0')}`;
const day = (v: unknown) => dateS(typeof v === 'string' ? v : v ? new Date(v as any).toISOString() : null);
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** símbolo comum às linhas, ou null se houver mais de uma moeda (valores de moedas diferentes não se somam) */
const oneCurrency = (rows: R[], cur: (r: R) => { symbol?: string } | undefined): string | null => {
  const set = new Set(rows.map((r) => cur(r)?.symbol ?? 'Kz'));
  return set.size <= 1 ? ([...set][0] ?? 'Kz') : null;
};

function build(o: {
  title: string;
  ctx: ListPdfContext;
  unit: [string, string];
  summary: Array<[string, string]>;
  columns: TableColumn[];
  rows: string[][];
  totals?: string[];
  empty: string;
  note?: string;
  size?: number;
}): Buffer {
  const pdf = new TablePdf({
    title: o.title,
    count: o.ctx.truncated ? `${plural(o.rows.length, o.unit[0], o.unit[1])} de ${num(o.ctx.total)}` : plural(o.ctx.total, o.unit[0], o.unit[1]),
    filters: o.ctx.filters,
    summary: o.summary,
    generatedBy: o.ctx.generatedBy,
  });
  pdf.table(o.columns, o.rows, { emptyText: o.empty, totals: o.rows.length ? o.totals : undefined, fontSize: o.size });
  if (o.note) pdf.note(o.note);
  if (o.ctx.truncated) pdf.note(`Exportação limitada a ${num(o.rows.length)} linhas. Total que corresponde aos filtros: ${num(o.ctx.total)}. Use os filtros para exportar o restante.`);
  return pdf.finish();
}

/* ───────────────────────────── Facturas ───────────────────────────── */
export function invoicesPdf(rows: R[], ctx: ListPdfContext): Buffer {
  const symbol = oneCurrency(rows, (i) => i.currency);
  const total = sum(rows, (i) => i.amount);
  const late = rows.filter((i) => n(i.overdueDays) > 0);
  return build({
    title: 'Facturas', ctx, unit: ['factura', 'facturas'],
    summary: [
      ['Valor total', symbol ? money(total, symbol) : 'várias moedas'],
      ['Vencidas', `${num(late.length)}${symbol ? ` · ${money(sum(late, (i) => i.amount), symbol)}` : ''}`],
      ['Em processo', num(rows.filter((i) => i.inProcess).length)],
    ],
    columns: [
      { header: 'Número', width: 1.5 }, { header: 'Devedor', width: 3 }, { header: 'Valor', width: 1.6, align: 'right', nowrap: true },
      { header: 'Emissão', width: 1, align: 'center', nowrap: true }, { header: 'Vencimento', width: 1.1, align: 'center', nowrap: true },
      { header: 'Atraso', width: 0.9, align: 'right', nowrap: true }, { header: 'Estado', width: 1.4 }, { header: 'Em processo', width: 1, align: 'center' },
    ],
    rows: rows.map((i) => {
      const od = n(i.overdueDays);
      return [dash(i.referenceNumber), dash(i.debtor?.name), money(i.amount, i.currency?.symbol ?? 'Kz'), day(i.issueDate), day(i.dueDate), od > 0 ? `${od} d` : '—', dash(i.invoiceState?.name), i.inProcess ? 'Sim' : 'Não'];
    }),
    totals: ['Total', '', symbol ? money(total, symbol) : '—', '', '', '', '', ''],
    empty: 'Nenhuma factura corresponde aos filtros escolhidos.',
    note: symbol ? undefined : 'Há facturas em moedas diferentes: os valores da coluna não são somados.',
  });
}

/* ───────────────────────────── Devedores ───────────────────────────── */
export function debtorsPdf(rows: R[], ctx: ListPdfContext): Buffer {
  const companies = rows.filter((d) => d.isCompany).length;
  const active = rows.filter((d) => d.isActive).length;
  return build({
    title: 'Devedores', ctx, unit: ['devedor', 'devedores'],
    summary: [
      ['Activos', `${num(active)} de ${num(rows.length)}`],
      ['Empresas', num(companies)],
      ['Particulares', num(rows.length - companies)],
    ],
    columns: [
      { header: 'Devedor', width: 3 }, { header: 'NIF', width: 1.4, nowrap: true }, { header: 'Tipo', width: 1.2 }, { header: 'Telefone', width: 1.4, nowrap: true },
      { header: 'Email', width: 2.9 }, { header: 'Credor', width: 1.9 }, { header: 'Estado', width: 1, align: 'center' }, { header: 'Registado', width: 1.1, align: 'center', nowrap: true },
    ],
    rows: rows.map((d) => [
      dash(d.name), dash(d.nif), dash(d.debtorType?.name ?? (d.isCompany ? 'Empresa' : 'Particular')), dash(d.phoneNumber),
      dash(d.email), dash(d.organization?.name), d.isActive ? 'Activo' : 'Inactivo', day(d.createdAt),
    ]),
    totals: [`Total: ${num(rows.length)}`, '', '', '', '', '', '', ''],
    empty: 'Nenhum devedor corresponde aos filtros escolhidos.',
  });
}

/* ───────────────────────────── Processos ───────────────────────────── */
const CONTACT_LABEL: Record<string, string> = { attempted: 'Tentativa', answered: 'Atendido', negotiation_started: 'Negociação iniciada', no_answer: 'Sem resposta', failed: 'Falhou', pending: 'Pendente' };
export function processesPdf(rows: R[], ctx: ListPdfContext): Buffer {
  const owed = sum(rows, (p) => p.totalAmount);
  const invoices = sum(rows, (p) => p.invoicesCount);
  const contacts = sum(rows, (p) => p.contactsCount);
  const unassigned = rows.filter((p) => !p.assignment?.user && !p.assignment?.userId).length;
  return build({
    title: 'Processos de cobrança', ctx, unit: ['processo', 'processos'],
    summary: [
      ['Em dívida', money(owed)],
      ['Facturas', num(invoices)],
      ['Sem responsável', num(unassigned)],
      ['Nunca contactados', num(rows.filter((p) => !p.lastContactAt).length)],
    ],
    columns: [
      { header: 'Processo', width: 1.2, nowrap: true }, { header: 'Devedor', width: 3 }, { header: 'Facturas', width: 0.9, align: 'right', nowrap: true },
      { header: 'Em dívida', width: 1.7, align: 'right', nowrap: true }, { header: 'Estado', width: 1.3 }, { header: 'Agente', width: 2 },
      { header: 'Último contacto', width: 1.9 }, { header: 'Contactos', width: 0.9, align: 'right', nowrap: true },
    ],
    rows: rows.map((p) => [
      code('PRC', p.id), dash(p.debtor?.name), num(p.invoicesCount), money(p.totalAmount), dash(p.processState?.name),
      p.assignment?.user?.fullName ?? p.assignment?.user?.email ?? (p.assignment?.userId ? `#${p.assignment.userId}` : 'Sem responsável'),
      p.lastContactAt ? `${day(p.lastContactAt)}${p.lastContactStatus ? ` · ${CONTACT_LABEL[p.lastContactStatus] ?? p.lastContactStatus}` : ''}` : 'Nunca',
      num(p.contactsCount),
    ]),
    totals: ['Total', '', num(invoices), money(owed), '', '', '', num(contacts)],
    empty: 'Nenhum processo corresponde aos filtros escolhidos.',
  });
}

/* ───────────────────────────── Negociações ───────────────────────────── */
export const NEGOTIATION_LABEL: Record<string, string> = {
  PENDING_APPROVAL: 'Aguarda aprovação', ACTIVE: 'Em vigor', COMPLETED: 'Liquidado', BROKEN: 'Quebrado', REJECTED: 'Rejeitado', CANCELLED: 'Cancelado', RENEGOTIATED: 'Renegociado',
};
export function negotiationsPdf(rows: R[], ctx: ListPdfContext): Buffer {
  const debt = sum(rows, (x) => x.debtAmount);
  const agreed = sum(rows, (x) => x.finalAmount);
  const discount = Math.max(debt - agreed, 0);
  return build({
    title: 'Negociações', ctx, unit: ['acordo', 'acordos'],
    summary: [
      ['Dívida', money(debt)],
      ['Valor acordado', money(agreed)],
      ['Desconto', `${money(discount)}${debt ? ` (${pct((discount / debt) * 100)})` : ''}`],
      ['Quebrados', num(rows.filter((x) => x.status === 'BROKEN').length)],
    ],
    columns: [
      { header: 'Acordo', width: 1.2, nowrap: true }, { header: 'Devedor', width: 2.8 }, { header: 'NIF', width: 1.3, nowrap: true },
      { header: 'Dívida', width: 1.6, align: 'right', nowrap: true }, { header: 'Desconto', width: 0.9, align: 'right', nowrap: true },
      { header: 'Valor acordado', width: 1.7, align: 'right', nowrap: true }, { header: 'Modalidade', width: 1, align: 'center' },
      { header: 'Vigência', width: 1.8, align: 'center' }, { header: 'Processos', width: 0.9, align: 'right', nowrap: true }, { header: 'Estado', width: 1.8 },
    ],
    rows: rows.map((x) => [
      code('ACD', x.id), dash(x.debtor?.name), dash(x.debtor?.nif), money(x.debtAmount), n(x.discountRate) ? `−${pct(x.discountRate)}` : '—',
      money(x.finalAmount), x.isInstallment ? `${x.totalInstallments}x` : 'Único', `${day(x.startDate)} – ${day(x.endDate)}`,
      num(x.processesCount), NEGOTIATION_LABEL[x.status] ?? dash(x.status),
    ]),
    totals: ['Total', '', '', money(debt), '', money(agreed), '', '', '', ''],
    empty: 'Nenhuma negociação corresponde aos filtros escolhidos.',
  });
}

/* ───────────────────────────── Pagamentos ───────────────────────────── */
export const PAYMENT_LABEL: Record<string, string> = { PENDING: 'Aguarda confirmação', CONFIRMED: 'Confirmado', CANCELLED: 'Anulado', REVERSED: 'Estornado' };
const RECEIVER_LABEL: Record<string, string> = { CREDITOR: 'Credor', AGENCY: 'Agência' };
export function paymentsPdf(rows: R[], ctx: ListPdfContext & { debtorNames?: Record<number, string> }): Buffer {
  const base = (r: R) => r.amountBase ?? r.amount;
  const symbol = oneCurrency(rows, (p) => p.currency);
  const confirmed = rows.filter((p) => p.status === 'CONFIRMED');
  const pending = rows.filter((p) => p.status === 'PENDING');
  const lost = rows.filter((p) => p.status === 'CANCELLED' || p.status === 'REVERSED');
  return build({
    title: 'Pagamentos', ctx, unit: ['pagamento', 'pagamentos'],
    summary: [
      ['Confirmado', `${money(sum(confirmed, base))} (${num(confirmed.length)})`],
      ['Aguarda confirmação', `${money(sum(pending, base))} (${num(pending.length)})`],
      ['Anulados ou estornados', num(lost.length)],
    ],
    columns: [
      { header: 'Pagamento', width: 1.3, nowrap: true }, { header: 'Data', width: 1, align: 'center', nowrap: true }, { header: 'Devedor', width: 2.6 },
      { header: 'Acordo', width: 1.1, nowrap: true }, { header: 'Recebido por', width: 1.1, align: 'center' }, { header: 'Meio', width: 1.3 },
      { header: 'Referência', width: 1.4 }, { header: 'Registado por', width: 1.7 }, { header: 'Valor', width: 1.6, align: 'right', nowrap: true },
      { header: 'Estado', width: 1.85 },
    ],
    rows: rows.map((p) => [
      `PAG-${String(p.uuid ?? p.id ?? '').slice(0, 8).toUpperCase()}`, day(p.paidOn), dash(ctx.debtorNames?.[p.debtorId]), code('ACD', p.negotiationId),
      RECEIVER_LABEL[p.receiver] ?? dash(p.receiver), dash(p.paymentMethod?.name), dash(p.reference), dash(p.registeredBy?.fullName),
      money(p.amount, p.currency?.symbol ?? 'Kz'), PAYMENT_LABEL[p.status] ?? dash(p.status),
    ]),
    totals: ['Total', '', '', '', '', '', '', '', symbol ? money(sum(rows, (p) => p.amount), symbol) : money(sum(rows, base)), ''],
    empty: 'Nenhum pagamento corresponde aos filtros escolhidos.',
    note: symbol ? undefined : 'Há pagamentos em moedas diferentes: o total é apresentado na moeda base.',
  });
}
