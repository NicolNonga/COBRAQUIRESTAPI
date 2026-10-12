import { TeamScope } from '@/shared/application/team-scope';
import { Page } from '@/shared/domain/pagination';
import { LadderAction, LadderTaskStatus } from './ladder';

/** Passo que ficou em atraso nesta passagem do job (para escalar ao gestor). */
export interface OverdueLadderTask {
  executionId: string;
  processId: number;
  agentId: number | null;
  managerId: number | null;
  title: string;
  dueOn: string;
  debtorName: string;
}

export interface LadderTask {
  id: string;
  processId: number;
  debtorName: string;
  ladderId: number;
  stepId: number;
  title: string;
  actionType: LadderAction;
  processDay: number;
  executedAt: Date;
  dueOn: string;
  status: LadderTaskStatus;
  fulfilledAt: Date | null;
  fulfilledLate: boolean | null;
  fulfilledContactId: number | null;
  escalatedAt: Date | null;
  agentId: number | null;
  agentName: string | null;
}

export interface LadderTaskFilter {
  scope: TeamScope;
  page: number;
  perPage: number;
  statuses?: LadderTaskStatus[];
  agentId?: number;
  ladderId?: number;
  processId?: number;
  dueFrom?: string;
  dueTo?: string;
}

export interface ComplianceRow {
  agentId: number | null;
  agentName: string | null;
  tracked: number;
  fulfilledOnTime: number;
  fulfilledLate: number;
  overdue: number;
  pending: number;
  voided: number;
}

/**
 * Acompanhamento do cumprimento: um passo com prazo fica PENDING até alguém registar um contacto
 * no processo (FULFILLED, no prazo ou tarde); passado o prazo sem contacto → OVERDUE e escala ao gestor.
 */
export abstract class LadderTracking {
  /** processos fechados → VOID (deixa de fazer sentido cobrar o passo) */
  abstract voidClosedProcesses(): Promise<number>;
  /** primeiro contacto registado desde o dia da execução → FULFILLED (fulfilled_late se depois do prazo) */
  abstract markFulfilled(): Promise<number>;
  /** PENDING com prazo ultrapassado → OVERDUE (cada passo escala uma única vez) */
  abstract markOverdue(today: string): Promise<OverdueLadderTask[]>;
  abstract tasks(f: LadderTaskFilter): Promise<Page<LadderTask>>;
  abstract compliance(scope: TeamScope, from: string, to: string, agentId?: number): Promise<ComplianceRow[]>;
}
