import { BusinessRuleError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';

export interface NewInvoice {
  referenceNumber: string;
  amount: string;
  issueDate: string; // YYYY-MM-DD
  timeLimitDays: number;
  dueDate: string; // YYYY-MM-DD
  debtorId: number;
  currencyId: number;
  invoiceStateId: number;
  createdById: number;
  documentPath?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Regras de criação de factura (puras, testáveis sem BD). */
export class InvoiceFactory {
  static build(input: Omit<NewInvoice, 'dueDate' | 'amount'> & { amount: string | number }): NewInvoice {
    const amount = Money.of(input.amount);
    if (!amount.isPositive()) throw new BusinessRuleError('O valor da factura deve ser maior que zero');
    if (!Number.isInteger(input.timeLimitDays) || input.timeLimitDays < 0 || input.timeLimitDays > 3650) {
      throw new BusinessRuleError('Prazo de pagamento inválido (0–3650 dias)');
    }
    if (!ISO_DATE.test(input.issueDate)) throw new BusinessRuleError('Data de emissão inválida');
    const ref = input.referenceNumber.trim();
    if (!ref) throw new BusinessRuleError('Número da factura é obrigatório');
    return { ...input, referenceNumber: ref, amount: amount.toString(), dueDate: addDays(input.issueDate, input.timeLimitDays) };
  }
}

/** Soma de dias em datas de calendário (UTC), sem efeitos de fuso horário. */
export const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Dias de atraso (positivo) ou dias restantes (negativo) face a `today`. */
export const overdueDays = (dueDate: string, today: string): number =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
