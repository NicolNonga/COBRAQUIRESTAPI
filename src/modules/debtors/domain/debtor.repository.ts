import { Criteria } from '@/shared/domain/criteria';
import { Page } from '@/shared/domain/pagination';
import { DebtorOrmEntity } from '../infrastructure/debtor.orm-entities';

export type Debtor = DebtorOrmEntity;

export interface DebtorData {
  name: string;
  nif: string | null;
  email: string;
  phoneNumber: string;
  address: string;
  socialReason: string | null;
  organizationId: number;
  debtorTypeId: number;
  isCompany: boolean;
  logoPath?: string | null;
}

export interface ContactPersonData {
  name: string;
  email: string;
  contact: string;
  position: string;
}

export interface DebtorDashboard {
  totalDebtors: number;
  totalDebtorsActive: number;
  totalDebtorCompany: number;
  totalDebtorParticular: number;
}

/** Dívida do devedor: facturas ainda não liquidadas nem anuladas. */
export interface DebtorDebtSummary {
  /** soma das facturas em aberto (pendentes, em curso, vencidas, parcialmente pagas, em disputa) */
  totalDebt: string;
  /** parte dessa dívida que já está vencida */
  overdueDebt: string;
  /** soma das facturas já liquidadas */
  paidAmount: string;
  openInvoices: number;
  overdueInvoices: number;
}

export interface DebtorIdentityKeys {
  names: string[];
  emails: string[];
  phones: string[];
  nifs: string[];
}

export abstract class DebtorRepository {
  abstract create(data: DebtorData, contact: ContactPersonData): Promise<Debtor>;
  abstract bulkCreate(rows: Array<{ debtor: DebtorData; contact: ContactPersonData }>): Promise<number>;
  abstract update(id: number, data: Partial<DebtorData>, contact: ContactPersonData): Promise<boolean>;
  abstract findById(id: number): Promise<Debtor | null>;
  abstract setActive(id: number, active: boolean): Promise<boolean>;
  /** Devolve as chaves (lower) que já existem — 1 query para todo o ficheiro de import. */
  abstract existingIdentityKeys(keys: DebtorIdentityKeys): Promise<{ names: Set<string>; emails: Set<string>; phones: Set<string>; nifs: Set<string> }>;
  abstract findIdsByNameAndNif(pairs: Array<{ name: string; nif: string }>): Promise<Map<string, number>>;
}

export type DebtorField = 'name' | 'nif' | 'email' | 'organizationId' | 'debtorTypeId' | 'isActive' | 'isCompany' | 'createdAt' | 'organizationName';
export const DEBTOR_SORTABLE = ['name', 'createdAt', 'organizationName'] as const;

export abstract class DebtorQueries {
  abstract search(criteria: Criteria<DebtorField>): Promise<Page<Debtor>>;
  abstract activeDropdown(): Promise<Array<{ id: number; name: string }>>;
  abstract withoutWalletDropdown(): Promise<Array<{ id: number; name: string }>>;
  abstract dashboard(): Promise<DebtorDashboard>;
  /** dívida de UM devedor (1 query agregada sobre as facturas) */
  abstract debtSummary(debtorId: number): Promise<DebtorDebtSummary>;
}
