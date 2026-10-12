import { ExternalCustomer, ExternalInvoice, ExternalStatus } from '../../../domain/canonical';

/** Campos do Service Layer que o conector lê (em `$select`, para não puxar o documento inteiro). */
export const B1_INVOICE_FIELDS = [
  'DocEntry', 'DocNum', 'NumAtCard', 'CardCode', 'DocDate', 'DocDueDate', 'DocCurrency', 'DocTotal', 'PaidToDate',
  'DocTotalFc', 'PaidFC', 'BPL_IDAssignedToInvoice', 'DocumentStatus', 'Cancelled', 'UpdateDate', 'UpdateTime',
] as const;
export const B1_CUSTOMER_FIELDS = ['CardCode', 'CardName', 'CardType', 'FederalTaxID', 'EmailAddress', 'Phone1', 'Cellular', 'Address'] as const;

export interface B1Invoice {
  DocEntry: number;
  DocNum: number;
  NumAtCard?: string | null;
  CardCode: string;
  DocDate: string;
  DocDueDate: string;
  DocCurrency?: string | null;
  DocTotal?: number | null;
  PaidToDate?: number | null;
  DocTotalFc?: number | null;
  PaidFC?: number | null;
  DocumentStatus?: string | null;
  Cancelled?: string | null;
  BPL_IDAssignedToInvoice?: number | null;
  UpdateDate?: string | null;
  UpdateTime?: string | null;
}

export interface B1Customer {
  CardCode: string;
  CardName?: string | null;
  FederalTaxID?: string | null;
  EmailAddress?: string | null;
  Phone1?: string | null;
  Cellular?: string | null;
  Address?: string | null;
}

export interface B1MapOptions {
  companyCode: string;
  localCurrency: string;
  /** DocNum (número interno do B1) ou NumAtCard (número do documento impresso) */
  referenceField: 'DocNum' | 'NumAtCard';
}

const cents = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100);
const money = (c: number) => (Math.max(c, 0) / 100).toFixed(2);
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

/** UpdateTime vem como "HH:MM:SS" (ou "HH:MM" em versões antigas); sem hora fica no fim do dia, para nunca ficar atrás do cursor. */
export function changedAtOf(date?: string | null, time?: string | null): string | null {
  if (!date) return null;
  const d = day(date);
  const t = /^\d{2}:\d{2}(:\d{2})?$/.test(time ?? '') ? (time as string) : '23:59:59';
  return `${d}T${t.length === 5 ? `${t}:00` : t}.000Z`;
}

export function invoiceFromB1(d: B1Invoice, o: B1MapOptions): ExternalInvoice {
  const currency = (d.DocCurrency || o.localCurrency).toUpperCase();
  const foreign = currency !== o.localCurrency.toUpperCase();
  // em moeda estrangeira o B1 guarda o valor original em DocTotalFc/PaidFC; em moeda local em DocTotal/PaidToDate
  const total = cents(foreign ? d.DocTotalFc : d.DocTotal);
  const paid = cents(foreign ? d.PaidFC : d.PaidToDate);
  const open = Math.max(total - paid, 0);

  let status: ExternalStatus;
  if (d.Cancelled === 'tYES') status = 'CANCELLED';
  else if (d.DocumentStatus === 'bost_Close' || open === 0) status = 'CLEARED';
  else status = paid > 0 ? 'PARTIAL' : 'OPEN';

  return {
    externalId: String(d.DocEntry),
    // com várias filiais (BPL) cada filial é um credor; sem filiais, a própria empresa
    companyCode: d.BPL_IDAssignedToInvoice ? String(d.BPL_IDAssignedToInvoice) : o.companyCode,
    customerExternalId: d.CardCode,
    reference: String((o.referenceField === 'NumAtCard' && d.NumAtCard ? d.NumAtCard : d.DocNum) ?? d.DocEntry),
    issueDate: day(d.DocDate),
    dueDate: day(d.DocDueDate) || day(d.DocDate),
    amount: money(total),
    openAmount: status === 'CLEARED' || status === 'CANCELLED' ? '0.00' : money(open),
    currency,
    status,
    changedAt: changedAtOf(d.UpdateDate, d.UpdateTime),
  };
}

export function customerFromB1(c: B1Customer, companyCode: string): ExternalCustomer {
  const nif = (c.FederalTaxID ?? '').trim();
  return {
    externalId: c.CardCode,
    companyCode,
    name: (c.CardName ?? c.CardCode).trim(),
    nif: nif || null,
    email: (c.EmailAddress ?? '').trim() || null,
    phone: (c.Cellular ?? '').trim() || (c.Phone1 ?? '').trim() || null,
    address: (c.Address ?? '').trim() || null,
    // o B1 não distingue pessoa singular de colectiva; os NIF angolanos de empresas começam por 5 (heurística, revista pelo utilizador)
    isCompany: /^5\d{9}$/.test(nif),
  };
}
