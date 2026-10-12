import { Money } from '@/shared/domain/money';
import { DashboardFacts } from './dashboard.port';

/**
 * Taxa de sucesso por valor = recuperado ÷ posto em cobrança no período × 100.
 * Sem valor posto em cobrança no período → null (não é 0% nem infinito).
 * Pode passar de 100%: o recuperado inclui pagamentos de processos que entraram antes do período.
 */
export const successRate = (recovered: string, placed: string): string | null => {
  const p = Money.of(placed);
  if (!p.isPositive()) return null;
  return Money.of(Money.of(recovered).ratioOf(p)).toString();
};

export const withRate = <T extends DashboardFacts>(f: T): T & { successRate: string | null } => ({ ...f, successRate: successRate(f.recovered, f.placed) });
