import { Criteria } from '@/shared/domain/criteria';
import { Page } from '@/shared/domain/pagination';
import { InvoiceOrmEntity } from '../infrastructure/invoice.orm-entity';
import { NewInvoice } from './invoice';

export type Invoice = InvoiceOrmEntity;

export interface InvoicePdfCandidate {
  id: number;
  referenceNumber: string;
  debtorName: string;
  debtorNif: string | null;
}

export interface EditableInvoice {
  id: number;
  referenceNumber: string;
  amount: string;
  issueDate: string;
  timeLimitDays: number;
  dueDate: string;
  debtorId: number;
  currencyId: number;
  inProcess: boolean;
  stateCode: string;
}
export type InvoiceChanges = Partial<Pick<EditableInvoice, 'referenceNumber' | 'amount' | 'issueDate' | 'timeLimitDays' | 'dueDate' | 'debtorId' | 'currencyId'>> & {
  invoiceStateId?: number;
};

export abstract class InvoiceRepository {
  abstract create(data: NewInvoice): Promise<Invoice>;
  abstract bulkCreate(rows: NewInvoice[]): Promise<number>;
  abstract existingReferences(refs: string[]): Promise<Set<string>>;
  /** factura vencida: UPDATE set-based único, só sobre estados abertos */
  abstract markOverdue(overdueStateId: number, openStateIds: number[], today: string): Promise<number>;
  abstract pdfCandidates(): Promise<InvoicePdfCandidate[]>;
  /** só preenche se ainda estiver vazio (idempotente / sem sobrescrever em corrida) */
  abstract attachDocumentIfEmpty(id: number, path: string): Promise<boolean>;
  /** null = factura não existe; documentPath null = sem PDF */
  /** lê com lock de linha (edição concorrente) */
  abstract findForUpdate(id: number): Promise<EditableInvoice | null>;
  abstract update(id: number, data: InvoiceChanges): Promise<void>;
  /** processo aberto onde a factura está e se esse processo tem negociação activa */
  abstract processOf(id: number): Promise<{ processId: number; activeNegotiationId: number | null } | null>;
  /** retira a factura do processo (ex.: mudou de devedor); o job volta a colocá-la no processo certo */
  abstract detachFromProcess(id: number): Promise<void>;
  abstract documentOf(id: number): Promise<{ referenceNumber: string; documentPath: string | null } | null>;
}

/** Campos filtráveis/ordenáveis de facturas (contrato do domínio; o mapeamento SQL vive na infra). */
export type InvoiceField =
  | 'state'
  | 'debtorId'
  | 'currencyId'
  | 'amount'
  | 'dueDate'
  | 'issueDate'
  | 'inProcess'
  | 'reference'
  | 'debtorName'
  | 'debtorNif'
  | 'createdAt';

export const INVOICE_SORTABLE = ['dueDate', 'issueDate', 'amount', 'createdAt', 'reference', 'debtorName'] as const;

export abstract class InvoiceQueries {
  abstract search(criteria: Criteria<InvoiceField>): Promise<Page<Invoice & { overdueDays: number }>>;
}
