import { Page, PageRequest } from '@/shared/domain/pagination';
import { ErpProvider, ExternalStatus } from './canonical';
import { LocalInvoiceState, ReviewKind } from './reconciliation';

export type IntegrationStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ERROR';
export type RunTrigger = 'SCHEDULE' | 'MANUAL';
export type RunMode = 'DELTA' | 'FULL' | 'DRY_RUN';
export type RunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface CompanyCreditor {
  companyCode: string;
  organizationId: number;
  organizationName?: string;
}

export interface IntegrationSettings {
  provider: ErpProvider;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  credentialsEnc: string | null;
  autoClose: boolean;
  importDebtors: boolean;
  intervalMinutes: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastFullRunAt: Date | null;
  consecutiveFailures: number;
  cursors: Record<string, string>;
  actorUserId: number | null;
  updatedById: number | null;
  version: number;
  updatedAt: Date;
  companies: CompanyCreditor[];
}

export interface SettingsPatch {
  provider?: ErpProvider;
  config?: Record<string, unknown>;
  autoClose?: boolean;
  importDebtors?: boolean;
  intervalMinutes?: number;
}

/** A configuração da integração: uma única linha para toda a aplicação. */
export abstract class IntegrationSettingsRepository {
  abstract get(): Promise<IntegrationSettings>;
  abstract getForUpdate(): Promise<IntegrationSettings>;
  /** optimistic lock: false se outra pessoa alterou entretanto */
  abstract update(patch: SettingsPatch, expectedVersion: number, userId: number): Promise<boolean>;
  abstract replaceCompanies(rows: CompanyCreditor[]): Promise<void>;
  /** empresas do ERP ainda sem credor: cria o credor e a associação. Devolve código → credor das criadas */
  abstract createCreditors(rows: Array<{ companyCode: string; name: string; email: string | null; phone: string | null; address: string | null }>): Promise<Map<string, number>>;
  abstract setCredentials(encrypted: string | null, userId: number): Promise<void>;
  abstract setStatus(status: IntegrationStatus, userId: number | null, opts?: { actorUserId?: number; nextRunAt?: Date | null }): Promise<void>;
  abstract saveCursor(key: string, value: string): Promise<void>;
  /** regista o fim de uma execução real; devolve as falhas seguidas acumuladas */
  abstract recordOutcome(o: { ok: boolean; full: boolean; nextRunAt: Date }): Promise<number>;
}

export interface RunCounters {
  [key: string]: number;
}
export interface RunReportLine {
  externalId?: string;
  action: string;
  message: string;
}
export interface IntegrationRun {
  id: number;
  trigger: RunTrigger;
  mode: RunMode;
  provider: string;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  counters: RunCounters;
  report: RunReportLine[];
  error: string | null;
  triggeredById: number | null;
  triggeredByName?: string | null;
}

/** Histórico de execuções. Grava sempre fora da transacção da sincronização (uma simulação desfaz-se, o registo fica). */
export abstract class IntegrationRunRepository {
  /** execuções que ficaram "a correr" (a API caiu a meio) passam a falhadas */
  abstract failStale(): Promise<number>;
  abstract start(r: { trigger: RunTrigger; mode: RunMode; provider: string; triggeredById: number | null }): Promise<number>;
  abstract finish(id: number, r: { status: RunStatus; counters: RunCounters; report: RunReportLine[]; error: string | null }): Promise<void>;
  abstract list(req: PageRequest): Promise<Page<IntegrationRun>>;
  abstract get(id: number): Promise<IntegrationRun | null>;
  abstract latest(): Promise<IntegrationRun | null>;
}

export type RefEntity = 'DEBTOR' | 'INVOICE';
export interface ExternalRef {
  entity: RefEntity;
  externalId: string;
  localId: number;
  companyCode: string | null;
  status: ExternalStatus;
  amount: string | null;
  openAmount: string | null;
}
export interface RefUpsert extends Omit<ExternalRef, 'status' | 'amount' | 'openAmount'> {
  status: ExternalStatus;
  amount: string | null;
  openAmount: string | null;
  linkedBy: 'IMPORT' | 'MATCH' | 'MANUAL';
}

/** Ligação registo do ERP ↔ registo do Cobraqui. */
export abstract class ExternalRefRepository {
  abstract byExternalIds(entity: RefEntity, externalIds: string[]): Promise<Map<string, ExternalRef>>;
  abstract byLocalIds(entity: RefEntity, localIds: number[]): Promise<Map<number, ExternalRef>>;
  /** cria ou actualiza (estado, valores, visto agora) */
  abstract upsert(rows: RefUpsert[]): Promise<void>;
  /** facturas que o ERP dizia estarem em aberto e que esta execução ainda não viu */
  abstract openInvoicesNotSeenSince(since: Date, limit: number): Promise<string[]>;
  /** marca como vistas agora (sem mudar o estado) */
  abstract touch(entity: RefEntity, externalIds: string[]): Promise<void>;
}

export interface NewReview {
  runId: number | null;
  kind: ReviewKind;
  externalId: string;
  invoiceId: number | null;
  processId: number | null;
  summary: string;
  details?: Record<string, unknown>;
}
export type ReviewStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';
export interface ReviewItem extends NewReview {
  id: number;
  status: ReviewStatus;
  resolution: string | null;
  resolvedById: number | null;
  resolvedByName?: string | null;
  resolvedAt: Date | null;
  version: number;
  createdAt: Date;
  invoiceReference?: string | null;
  debtorName?: string | null;
}

export abstract class ReviewRepository {
  /** abre os casos; um caso igual ainda aberto não duplica. Devolve quantos abriram de novo */
  abstract open(items: NewReview[]): Promise<number>;
  abstract search(f: { status?: ReviewStatus; kind?: ReviewKind }, req: PageRequest): Promise<Page<ReviewItem>>;
  abstract findForUpdate(id: number): Promise<ReviewItem | null>;
  abstract resolve(id: number, version: number, status: Exclude<ReviewStatus, 'OPEN'>, resolution: string, userId: number): Promise<boolean>;
  abstract countOpen(): Promise<number>;
}

export interface InvoiceSnapshot {
  invoiceId: number;
  reference: string;
  state: LocalInvoiceState;
  amount: string;
  debtorId: number;
  processId: number | null;
  agreementActive: boolean;
}
export interface ProcessSettlement {
  processId: number;
  allSettled: boolean;
  agreementActive: boolean;
  debtorName: string;
  agentId: number | null;
  managerId: number | null;
}
export interface LocalInvoiceMatch {
  invoiceId: number;
  reference: string;
  debtorId: number;
  debtorNif: string | null;
  organizationId: number;
  amount: string;
}
export interface NewErpDebtor {
  name: string;
  nif: string | null;
  email: string;
  phone: string;
  address: string;
  isCompany: boolean;
  organizationId: number;
}
export interface NewErpInvoice {
  reference: string;
  amount: string;
  issueDate: string;
  dueDate: string;
  timeLimitDays: number;
  debtorId: number;
  currencyId: number;
  createdById: number;
}
export type ProcessCloseReason = 'PAID_IN_ERP' | 'CANCELLED_IN_ERP' | 'MANUAL';

/**
 * Escritas da integração nas tabelas de cobrança (facturas, processos, devedores).
 * Todas tolerantes a conflitos (ON CONFLICT DO NOTHING): um conflito nunca aborta a transacção da página.
 */
export abstract class CollectionLedger {
  abstract invoiceSnapshots(invoiceIds: number[]): Promise<Map<number, InvoiceSnapshot>>;
  abstract setInvoiceState(invoiceIds: number[], state: 'PAID' | 'CANCELLED'): Promise<void>;
  abstract updateInvoiceAmount(invoiceId: number, amount: string): Promise<boolean>;
  abstract processSettlements(processIds: number[]): Promise<ProcessSettlement[]>;
  /** fecha se continuar fechável (todas liquidadas, sem acordo); devolve se fechou */
  abstract closeProcess(processId: number, reason: ProcessCloseReason): Promise<boolean>;
  abstract invoicesByReference(references: string[]): Promise<LocalInvoiceMatch[]>;
  /** facturas por liquidar ainda sem ligação ao ERP (para as ligar), por id crescente */
  abstract unlinkedOpenInvoices(afterId: number, limit: number): Promise<Array<{ invoiceId: number; reference: string }>>;
  abstract debtorsByNif(nifs: string[]): Promise<Map<string, { debtorId: number; organizationId: number; name: string }>>;
  /** cria o devedor + pessoa de contacto; null se colidir com outro devedor (nome, email, telefone ou NIF) */
  abstract createDebtor(d: NewErpDebtor): Promise<number | null>;
  /** null se o número já existir */
  abstract createInvoice(i: NewErpInvoice): Promise<number | null>;
  abstract currencyIds(): Promise<Map<string, number>>;
  /** utilizadores a avisar quando a integração falha (permissão de gerir integração) */
  abstract integrationManagers(): Promise<number[]>;
}
