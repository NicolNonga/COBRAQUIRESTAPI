import { Money } from '@/shared/domain/money';
import { ExternalInvoice } from './canonical';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Erros que impedem criar a factura no Cobraqui (vazio = válida). Devolve também o prazo em dias. */
export function validateExternalInvoice(ext: ExternalInvoice): { errors: string[]; timeLimitDays: number } {
  const errors: string[] = [];
  if (!ext.reference?.trim()) errors.push('sem número de factura');
  if (!ISO.test(ext.issueDate)) errors.push(`data de emissão inválida (${ext.issueDate})`);
  if (!ISO.test(ext.dueDate)) errors.push(`data de vencimento inválida (${ext.dueDate})`);
  let amountOk = false;
  try {
    amountOk = Money.of(ext.amount).isPositive();
  } catch {
    amountOk = false;
  }
  if (!amountOk) errors.push(`valor inválido (${ext.amount})`);
  const timeLimitDays = ISO.test(ext.issueDate) && ISO.test(ext.dueDate) ? days(ext.issueDate, ext.dueDate) : 0;
  if (timeLimitDays < 0) errors.push('vencimento anterior à emissão');
  if (timeLimitDays > 3650) errors.push('prazo de pagamento acima de 10 anos');
  return { errors, timeLimitDays };
}

/** Normaliza o NIF para comparar (sem espaços, maiúsculas). */
export const normalizeNif = (nif: string | null | undefined): string | null => {
  const n = (nif ?? '').replace(/\s+/g, '').toUpperCase();
  return n || null;
};
