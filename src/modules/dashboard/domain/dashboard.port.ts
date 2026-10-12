import { TeamScope } from '@/shared/application/team-scope';

export interface DashboardFilter {
  /** período (YYYY-MM-DD, calendário de Luanda) para "posto em cobrança" e "recuperado" */
  from: string;
  to: string;
  scope: TeamScope;
  agentId?: number;
  organizationId?: number;
  baseCurrencyCode: string;
}

/** Linha bruta (valores em moeda base, como string decimal). */
export interface DashboardFacts {
  /** saldo em cobrança agora: processos abertos (acordo em vigor → em falta do acordo; senão Σ facturas) */
  inCollection: string;
  openProcesses: number;
  /** Σ facturas dos processos que entraram em cobrança no período */
  placed: string;
  placedProcesses: number;
  /** Σ pagamentos confirmados com data de pagamento no período (estornados não contam) */
  recovered: string;
  recoveredPayments: number;
  /** pagamentos registados à espera de confirmação (qualquer data) */
  pendingConfirmation: string;
}

export interface AgentFacts extends DashboardFacts {
  agentId: number | null;
  agentName: string | null;
}

export interface CreditorFacts extends DashboardFacts {
  organizationId: number;
  organizationName: string;
  commissionRate: string;
}

export interface MonthlyFacts {
  month: string; // YYYY-MM
  placed: string;
  recovered: string;
}

/** Leituras agregadas para o painel (só leitura; nada de ORM, SQL agregado com índices). */
export abstract class DashboardQueries {
  abstract totals(f: DashboardFilter): Promise<DashboardFacts>;
  abstract byAgent(f: DashboardFilter): Promise<AgentFacts[]>;
  abstract byCreditor(f: DashboardFilter): Promise<CreditorFacts[]>;
  abstract monthly(f: DashboardFilter): Promise<MonthlyFacts[]>;
}
