import { Criteria } from '@/shared/domain/criteria';
import { Page, PageRequest } from '@/shared/domain/pagination';
import {
  ContactOrmEntity,
  ContactStatus,
  ProcessAssignmentOrmEntity,
  ProcessInvoiceOrmEntity,
  ProcessOrmEntity,
} from '../infrastructure/process.orm-entities';

export type Process = ProcessOrmEntity;

export interface GenerationResult {
  processesCreated: number;
  invoicesLinked: number;
}

export interface Assignment {
  processId: number;
  userId: number;
}

export interface NewTransfer {
  processId: number;
  fromUserId: number;
  toUserId: number;
  performedById: number | null;
  reason: string;
  notes: string | null;
  isPermanent: boolean;
  returnAt: Date | null;
}

/** Comandos sobre processos — todos set-based (sem loops de queries). */
export abstract class ProcessCommandRepository {
  abstract generateFromOverdueInvoices(overdueStateId: number, openProcessStateId: number): Promise<GenerationResult>;
  abstract assignFromWallets(): Promise<Assignment[]>;
  abstract autoAssignRoundRobin(excludeRoleSlug: string): Promise<Assignment[]>;
  abstract findOpen(processId: number): Promise<Process | null>;
  /** INSERT; devolve false se o processo já tiver responsável */
  abstract assign(processId: number, userId: number): Promise<boolean>;
  abstract currentAssignee(processId: number): Promise<number | null>;
  /** bloqueia (FOR UPDATE) as atribuições de `processIds` que pertencem a `userId`; devolve os ids encontrados */
  abstract lockAssignments(processIds: number[], userId: number): Promise<number[]>;
  abstract reassign(processIds: number[], fromUserId: number, toUserId: number): Promise<number>;
  abstract insertTransfers(rows: NewTransfer[]): Promise<number[]>;
  abstract returnDueTemporaryTransfers(): Promise<Array<{ processId: number; userId: number }>>;
  /** remove facturas do processo e coloca-as em disputa; devolve ids efectivamente removidos */
  abstract detachInvoicesToDispute(processId: number, invoiceIds: number[], disputeStateId: number): Promise<number[]>;
  abstract hasActiveNegotiation(processId: number): Promise<boolean>;
  /**
   * Arranque da cobrança: processos ainda REGISTADOS passam a "Em cobrança".
   * Só mexe nos que estão nesse estado e abertos — é idempotente e nunca faz retroceder um processo.
   * Devolve quantos mudaram.
   */
  abstract startCollection(processIds: number[], registeredStateId: number, inProgressStateId: number): Promise<number>;
}

export interface ProcessLock {
  id: number;
  debtorId: number;
  isOpen: boolean;
}

/** Porta exposta ao módulo de negociações (Interface Segregation). */
export abstract class ProcessLookup {
  /** SELECT … FOR UPDATE dos processos (ordenado por id → evita deadlocks) */
  abstract lockForUpdate(ids: number[]): Promise<ProcessLock[]>;
  /** soma (NUMERIC exacto) das facturas actualmente associadas aos processos */
  abstract outstandingAmount(ids: number[]): Promise<string>;
}

export interface NewContact {
  processId: number;
  userId: number;
  contactTypeId: number;
  status: ContactStatus;
  contactedAt: Date;
  notes: string | null;
  durationSeconds: number | null;
}

export type ContactField = 'processId' | 'userId' | 'contactTypeId' | 'status' | 'contactedAt' | 'notes';
export const CONTACT_SORTABLE = ['contactedAt'] as const;

/** Histórico de contactos (append-only: contactos não são editados nem apagados). */
export abstract class ContactRepository {
  abstract create(data: NewContact): Promise<number>;
  /** actualiza o resumo do processo; seguro com contactos concorrentes e registos fora de ordem */
  abstract touchProcessSummary(processId: number, contactedAt: Date, status: ContactStatus): Promise<void>;
  abstract search(criteria: Criteria<ContactField>): Promise<Page<ContactOrmEntity>>;
}

export type ProcessListItem = Process & {
  invoices: ProcessInvoiceOrmEntity['invoice'][];
  invoicesCount: number;
  totalAmount: string;
  /** já preso a um acordo activo ou à espera de aprovação (não pode entrar noutro) */
  inNegotiation: boolean;
};

export type ProcessField = 'debtorId' | 'state' | 'assignedUserId' | 'closedAt' | 'createdAt' | 'startDate' | 'debtorName' | 'debtorNif' | 'lastContactAt' | 'lastContactStatus' | 'contactsCount';
export const PROCESS_SORTABLE = ['createdAt', 'startDate', 'debtorName', 'lastContactAt', 'contactsCount'] as const;

export abstract class ProcessQueries {
  abstract search(criteria: Criteria<ProcessField>): Promise<Page<ProcessListItem>>;
  abstract paginateAssignedTo(userId: number, req: PageRequest): Promise<Page<ProcessAssignmentOrmEntity>>;
  abstract paginateInvoicesOf(processId: number, req: PageRequest): Promise<Page<ProcessInvoiceOrmEntity>>;
}
