/**
 * Fórmulas dos indicadores de Contas a Receber (puras, testáveis).
 * Valores monetários chegam como number (moeda base). Devolvem null quando o cálculo não faz sentido
 * (divisão por zero) — o ecrã mostra "—" e a explicação.
 */

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * DSO (Days Sales Outstanding) — prazo médio de recebimento.
 * DSO = saldo a receber no fim do período ÷ facturação do período × dias do período.
 */
export const dso = (receivableEnd: number, sales: number, days: number): number | null =>
  sales > 0 && days > 0 ? round((Math.max(0, receivableEnd) / sales) * days, 0) : null;

/**
 * CEI (Collection Effectiveness Index) — eficiência real da cobrança.
 * CEI = (saldo inicial + facturação − saldo final) ÷ (saldo inicial + facturação − saldo final ainda não vencido) × 100.
 * 100% = cobrou-se tudo o que era cobrável no período.
 */
export const cei = (receivableStart: number, sales: number, receivableEnd: number, currentEnd: number): number | null => {
  const collectible = receivableStart + sales - Math.max(0, currentEnd);
  if (collectible <= 0) return null;
  const collected = receivableStart + sales - receivableEnd;
  return round(Math.max(0, (collected / collectible) * 100));
};

/** percentagem simples (null se o total é zero) */
export const pct = (part: number, total: number, digits = 1): number | null => (total > 0 ? round((part / total) * 100, digits) : null);

/** Custo por cobrança: custos do período ÷ valor recuperado × 100 (quantos Kz custa recuperar 100 Kz). */
export const costToCollect = (costs: number, recovered: number): number | null => pct(costs, recovered, 1);

/* ───────── aging ───────── */
export const AGING_BUCKETS = [
  { key: 'CURRENT', label: 'A vencer', min: -Infinity, max: 0 },
  { key: 'D1_30', label: '1–30 dias', min: 1, max: 30 },
  { key: 'D31_60', label: '31–60 dias', min: 31, max: 60 },
  { key: 'D61_90', label: '61–90 dias', min: 61, max: 90 },
  { key: 'D91_180', label: '91–180 dias', min: 91, max: 180 },
  { key: 'D180_PLUS', label: 'Mais de 180 dias', min: 181, max: Infinity },
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number]['key'];
export const bucketOf = (daysOverdue: number): AgingBucket => AGING_BUCKETS.find((b) => daysOverdue >= b.min && daysOverdue <= b.max)!.key;
export const bucketLabel = (k: string) => AGING_BUCKETS.find((b) => b.key === k)?.label ?? k;
/** limiar a partir do qual uma dívida vencida é considerada perda provável */
export const LOSS_THRESHOLD_DAYS = 90;

/* ───────── rótulos ───────── */
export const CONTACT_STATUS_LABEL: Record<string, string> = {
  attempted: 'Tentativa', answered: 'Atendido', negotiation_started: 'Negociação iniciada', no_answer: 'Sem resposta', failed: 'Falhou', pending: 'Pendente',
};
export const DISPUTE_OUTCOME_LABEL: Record<string, string> = { UPHELD: 'Procedente (volta à cobrança)', CANCELLED: 'Factura anulada', ADJUSTED: 'Valor corrigido' };
export const COST_CATEGORIES = ['STAFF', 'COMMUNICATIONS', 'TECHNOLOGY', 'TRAVEL', 'LEGAL', 'OFFICE', 'OTHER'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  STAFF: 'Pessoal', COMMUNICATIONS: 'Comunicações (chamadas, SMS)', TECHNOLOGY: 'Tecnologia e sistemas', TRAVEL: 'Deslocações',
  LEGAL: 'Jurídico', OFFICE: 'Instalações', OTHER: 'Outros',
};
