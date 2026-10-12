import { Criteria } from '@/shared/domain/criteria';
import { Page, PageRequest } from '@/shared/domain/pagination';
import { UserOrmEntity } from '../infrastructure/user.orm-entities';

export type User = UserOrmEntity;

export interface NewUser {
  fullName: string | null;
  email: string;
  passwordHash: string;
  phoneNumber: string | null;
  roleId: number;
  categoryId: number | null;
  organizationId: number | null;
}

export interface UserCredentials {
  id: number;
  email: string;
  passwordHash: string;
  isActive: boolean;
  tokenVersion: number;
}

export interface AuthSnapshot {
  id: number;
  email: string;
  isActive: boolean;
  tokenVersion: number;
  roleId: number | null;
  roleActive: boolean;
  isManager: boolean;
  organizationId: number | null;
}

/** Escrita/consulta de utilizadores. */
export abstract class UserRepository {
  abstract create(data: NewUser): Promise<User>;
  abstract update(id: number, data: Partial<Pick<User, 'fullName' | 'email' | 'phoneNumber' | 'roleId' | 'categoryId' | 'isActive'>>): Promise<boolean>;
  abstract findById(id: number): Promise<User | null>;
  abstract findCredentialsByEmail(email: string): Promise<UserCredentials | null>;
  abstract findCredentialsById(id: number): Promise<UserCredentials | null>;
  abstract findAuthSnapshot(id: number): Promise<AuthSnapshot | null>;
  /** muda a palavra-passe e invalida sessões existentes (token_version + 1) */
  abstract setPassword(id: number, passwordHash: string, opts?: { firstAccess?: boolean }): Promise<void>;
  abstract setPasswordByEmail(email: string, passwordHash: string): Promise<boolean>;
  abstract bumpTokenVersion(id: number): Promise<void>;
  /** id do gestor do agente (wallet_agents) ou null */
  abstract managerOf(agentId: number): Promise<number | null>;
  abstract findDetailedWithPermissions(id: number): Promise<User & { permissions: string[] } | null>;
}

export type UserField = 'fullName' | 'email' | 'roleId' | 'organizationId' | 'categoryId' | 'isActive' | 'createdAt';
export const USER_SORTABLE = ['fullName', 'email', 'createdAt'] as const;

/** Leitura (CQRS-lite): listas e dropdowns. */
export abstract class UserQueries {
  abstract search(criteria: Criteria<UserField>): Promise<Page<User>>;
  abstract activeDropdown(): Promise<Array<Pick<User, 'id' | 'fullName' | 'email'>>>;
  abstract activeManagers(): Promise<Array<Pick<User, 'id' | 'fullName' | 'email'>>>;
  abstract findInOrganization(userId: number, organizationId: number): Promise<User | null>;
}

/** Hierarquia gestor/agente. */
export abstract class TeamRepository {
  abstract assignAgentToManager(agentId: number, managerId: number): Promise<void>;
  abstract paginateAgents(managerId: number, req: PageRequest): Promise<Page<User>>;
  abstract listAgents(managerId: number): Promise<User[]>;
}
