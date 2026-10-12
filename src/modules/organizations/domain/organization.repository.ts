import { Criteria } from '@/shared/domain/criteria';
import { Page } from '@/shared/domain/pagination';

export interface Organization {
  id: number;
  name: string;
  email: string;
  phoneNumber: string;
  address: string;
  logoPath: string | null;
  isActive: boolean;
}

export type OrganizationField = 'name' | 'email' | 'phoneNumber' | 'isActive' | 'createdAt';
export const ORGANIZATION_SORTABLE = ['name', 'createdAt'] as const;

export type NewOrganization = Omit<Organization, 'id' | 'isActive'>;

export abstract class OrganizationRepository {
  abstract create(data: NewOrganization): Promise<Organization>;
  /** inserção em lote; ignora duplicados (email/nome/telefone) e devolve quantos entraram */
  abstract bulkInsertIgnoringDuplicates(rows: NewOrganization[]): Promise<number>;
  abstract setActive(id: number, active: boolean): Promise<boolean>;
  abstract findById(id: number): Promise<Organization | null>;
  abstract update(id: number, data: Partial<NewOrganization>): Promise<boolean>;
  abstract search(criteria: Criteria<OrganizationField>): Promise<Page<Organization>>;
  abstract listActive(): Promise<Pick<Organization, 'id' | 'name'>[]>;
  abstract findIdsByNames(names: string[]): Promise<Map<string, number>>;
}
