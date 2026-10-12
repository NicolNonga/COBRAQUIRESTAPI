import { Page } from '@/shared/domain/pagination';
import { DebtorChannel, LadderAction, LadderPriority, LadderRecipients, LadderStepInput } from './ladder';

export interface LadderStep extends LadderStepInput {
  id: number;
}

export interface Ladder {
  id: number;
  ownerUserId: number;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
  policyVersion: number | null;
  policyCompliant: boolean;
  policyViolations: Array<{ code: string; message: string; dayOffset?: number }> | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  steps?: LadderStep[];
}

/** Uma etapa que chegou ao dia num processo (devolvida pelo motor já registada como executada). */
export interface DueLadderStep {
  processId: number;
  stepId: number;
  day: number;
  agentId: number;
  managerId: number | null;
  actionType: LadderAction;
  recipients: LadderRecipients;
  priority: LadderPriority;
  title: string;
  messageTemplate: string;
  debtorName: string;
  totalAmount: string;
  invoicesCount: number;
  fulfillmentDays: number | null;
  debtorId: number;
  debtorEmail: string | null;
  debtorPhone: string | null;
  debtorChannel: DebtorChannel;
  debtorSubject: string | null;
  debtorMessageTemplate: string | null;
}

export interface LadderPreviewRow extends Omit<DueLadderStep, 'agentId' | 'managerId' | 'fulfillmentDays' | 'debtorId'> {
  alreadyExecuted: boolean;
}

export abstract class LadderRepository {
  abstract create(ownerUserId: number, data: { name: string; description: string | null; policyVersion: number }, steps: LadderStepInput[]): Promise<Ladder>;
  abstract findById(id: number): Promise<Ladder | null>;
  /** lock pessimista para edição/activação (evita duas edições concorrentes) */
  abstract findForUpdate(id: number): Promise<Ladder | null>;
  /**
   * Substitui as etapas comparando por dia: mesmo dia → actualiza (mantém o id e as execuções),
   * dia removido → remoção lógica, dia novo → insere. Incrementa a versão.
   */
  abstract replaceSteps(id: number, data: { name: string; description: string | null; policyVersion: number }, steps: LadderStepInput[]): Promise<void>;
  abstract setActive(id: number, active: boolean): Promise<void>;
  abstract deactivateOthers(ownerUserId: number, exceptId: number): Promise<void>;
  abstract archive(id: number): Promise<void>;
  abstract listByOwner(ownerUserId: number, includeArchived: boolean, page: number, perPage: number): Promise<Page<Ladder>>;
  abstract executionsCount(id: number): Promise<number>;
  /** todas as réguas não arquivadas, com etapas — para revalidar quando a régua master muda */
  abstract listAllWithSteps(): Promise<Ladder[]>;
  abstract setCompliance(id: number, compliant: boolean, violations: Array<{ code: string; message: string; dayOffset?: number }> | null, policyVersion: number): Promise<void>;
}

export interface LadderCoverageRow {
  processId: number;
  debtorName: string;
  day: number;
  startDate: string;
  hasActiveNegotiation: boolean;
  nextStepDay: number | null;
  nextStepTitle: string | null;
  lastStepDay: number | null;
}

export abstract class LadderEngine {
  /** Regista e devolve as etapas devidas hoje (idempotente: cada etapa corre 1× por processo). */
  abstract claimDueSteps(today: string, catchUpDays: number): Promise<DueLadderStep[]>;
  /** Mesma lógica, sem gravar: "o que aconteceria hoje" para a régua de um comercial. */
  abstract preview(ladderId: number, ownerUserId: number, today: string, catchUpDays: number): Promise<LadderPreviewRow[]>;
  /** processos abertos do dono da régua, com o dia em que estão e a próxima etapa (para explicar a pré-visualização) */
  abstract coverage(ladderId: number, ownerUserId: number, today: string): Promise<LadderCoverageRow[]>;
  /**
   * Processos abertos que passaram a duração máxima de cobrança da régua master e ainda não foram avisados
   * (marca-os como avisados: avisa-se uma só vez por processo).
   */
  abstract claimLimitExceeded(today: string): Promise<LimitExceededRow[]>;
}

export interface LimitExceededRow {
  processId: number;
  debtorName: string;
  agentId: number | null;
  managerId: number | null;
  day: number;
  maxDays: number;
}
