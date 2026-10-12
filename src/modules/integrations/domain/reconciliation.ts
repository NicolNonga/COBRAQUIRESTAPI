import { Money } from '@/shared/domain/money';
import { ExternalInvoice, ExternalStatus } from './canonical';

/**
 * Reconciliação — regra pura: estado da factura no Cobraqui + estado no ERP → o que fazer.
 * Não toca na BD; o caso de uso aplica a decisão. Testada em reconciliation.spec.ts.
 */

export type LocalInvoiceState = 'PENDING' | 'IN_PROGRESS' | 'IN_DISPUTE' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED' | 'OVERDUE';

export const REVIEW_KINDS = [
  'PROCESS_READY_TO_CLOSE',
  'PAID_WITH_AGREEMENT',
  'CANCELLED_WITH_AGREEMENT',
  'PARTIAL_WITH_AGREEMENT',
  'AMOUNT_CHANGED_WITH_AGREEMENT',
  'PAID_IN_DISPUTE',
  'PAYMENT_REVERSED',
  'MISSING_IN_ERP',
  'AMBIGUOUS_MATCH',
  'DEBTOR_INCOMPLETE',
  'DEBTOR_CONFLICT',
  'UNMAPPED_COMPANY',
  'INVALID_DATA',
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export interface LocalInvoice {
  invoiceId: number;
  reference: string;
  state: LocalInvoiceState;
  amount: string;
  /** processo ABERTO a que a factura pertence (null = fora de processo ou processo fechado) */
  processId: number | null;
  /** o processo tem um acordo activo ou à espera de aprovação */
  agreementActive: boolean;
  /** o que o ERP dizia na última leitura (para só agir quando algo muda) */
  lastSeen: { status: ExternalStatus; amount: string | null; openAmount: string | null };
}

export type Decision =
  | { action: 'NONE' }
  | { action: 'MARK_PAID' }
  | { action: 'MARK_CANCELLED' }
  /** pago em parte no ERP: o valor em aberto fica registado na ligação externa */
  | { action: 'RECORD_PARTIAL'; openAmount: string }
  | { action: 'UPDATE_AMOUNT'; amount: string }
  | { action: 'REVIEW'; kind: ReviewKind; summary: string };

const NONE: Decision = { action: 'NONE' };
const SETTLED: ReadonlySet<LocalInvoiceState> = new Set(['PAID', 'CANCELLED']);
const same = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Money.of(a).equals(b));
const review = (kind: ReviewKind, summary: string): Decision => ({ action: 'REVIEW', kind, summary });

export function decide(local: LocalInvoice, ext: ExternalInvoice | null): Decision {
  const ref = `Factura ${local.reference}`;

  if (!ext) {
    return SETTLED.has(local.state) ? NONE : review('MISSING_IN_ERP', `${ref} deixou de aparecer no ERP. Confirme se foi apagada ou movida antes de continuar a cobrança.`);
  }

  // só se age quando o ERP mudou desde a última leitura: uma revisão ignorada não volta a abrir sozinha
  const changed = ext.status !== local.lastSeen.status || !same(ext.amount, local.lastSeen.amount) || !same(ext.openAmount, local.lastSeen.openAmount);
  if (!changed) return NONE;

  if (SETTLED.has(local.state)) {
    const settledByErp = local.lastSeen.status === 'CLEARED' || local.lastSeen.status === 'CANCELLED';
    if (settledByErp && (ext.status === 'OPEN' || ext.status === 'PARTIAL')) {
      return review('PAYMENT_REVERSED', `${ref} voltou a estar em aberto no ERP (pagamento ou anulação estornados). Decida se a cobrança deve ser retomada.`);
    }
    return NONE;
  }

  if (local.state === 'IN_DISPUTE') {
    if (ext.status === 'CLEARED' || ext.status === 'CANCELLED') {
      return review('PAID_IN_DISPUTE', `${ref} está em disputa e aparece ${ext.status === 'CLEARED' ? 'paga' : 'anulada'} no ERP. Encerre a disputa.`);
    }
    return NONE;
  }

  if (local.agreementActive) {
    switch (ext.status) {
      case 'CLEARED':
        return review('PAID_WITH_AGREEMENT', `${ref} foi paga directamente ao credor (ERP), mas o processo tem um acordo activo. Registe o pagamento no acordo para o concluir.`);
      case 'CANCELLED':
        return review('CANCELLED_WITH_AGREEMENT', `${ref} foi anulada no ERP, mas o processo tem um acordo activo. Reveja o acordo.`);
      case 'PARTIAL':
        return review('PARTIAL_WITH_AGREEMENT', `${ref} tem um pagamento parcial no ERP (em aberto: ${ext.openAmount}) e o processo tem um acordo activo.`);
      case 'OPEN':
        return same(ext.amount, local.amount)
          ? NONE
          : review('AMOUNT_CHANGED_WITH_AGREEMENT', `O valor de ${ref} mudou no ERP (${local.amount} → ${ext.amount}) e o processo tem um acordo activo.`);
    }
  }

  switch (ext.status) {
    case 'CLEARED':
      return { action: 'MARK_PAID' };
    case 'CANCELLED':
      return { action: 'MARK_CANCELLED' };
    case 'PARTIAL':
      return { action: 'RECORD_PARTIAL', openAmount: ext.openAmount };
    case 'OPEN':
      return same(ext.amount, local.amount) ? NONE : { action: 'UPDATE_AMOUNT', amount: ext.amount };
  }
}

/** O processo pode fechar quando todas as facturas estão liquidadas ou anuladas e não há acordo em curso. */
export function processClosure(p: { allSettled: boolean; agreementActive: boolean; autoClose: boolean }): 'CLOSE' | 'REVIEW' | 'KEEP_OPEN' {
  if (!p.allSettled || p.agreementActive) return 'KEEP_OPEN';
  return p.autoClose ? 'CLOSE' : 'REVIEW';
}
