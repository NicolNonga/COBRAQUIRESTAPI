import { Page, PageRequest } from '@/shared/domain/pagination';

export interface Role {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isManager: boolean;
  permissions?: Permission[];
}

export interface Permission {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export const SUPER_ADMIN_SLUG = 'super-admin';
export const ADMIN_ROLE_NAME = 'admin';

/** O perfil super-admin é do sistema: não se edita, não se activa/desactiva e as permissões são sempre todas. */
export const isProtectedRole = (role: Pick<Role, 'slug'>): boolean => role.slug === SUPER_ADMIN_SLUG;
export const PROTECTED_ROLE_MESSAGE = 'O perfil super-admin é do sistema: tem sempre todas as permissões e não pode ser alterado.';

export abstract class RoleRepository {
  abstract findById(id: number): Promise<Role | null>;
  abstract existsByName(name: string, exceptId?: number): Promise<boolean>;
  abstract create(data: Pick<Role, 'slug' | 'name' | 'description' | 'isManager'>): Promise<Role>;
  abstract update(id: number, data: Partial<Pick<Role, 'name' | 'description' | 'isActive' | 'isManager'>>): Promise<boolean>;
  abstract paginateWithActivePermissions(req: PageRequest): Promise<Page<Role>>;
  abstract listActive(filter: { excludeSlug?: string; onlyManagers?: boolean }): Promise<Role[]>;
}

export abstract class PermissionRepository {
  abstract create(data: Pick<Permission, 'slug' | 'name' | 'description'>): Promise<Permission>;
  abstract setActive(id: number, active: boolean): Promise<boolean>;
  abstract paginate(req: PageRequest): Promise<Page<Permission>>;
  abstract listActive(): Promise<Permission[]>;
  /** slugs activos de um perfil activo — usado na autorização */
  abstract activeSlugsForRole(roleId: number): Promise<string[]>;
  /** permissões efectivas = as do perfil (se activo) + as concedidas ao próprio utilizador */
  abstract activeSlugsForUser(userId: number, roleId: number | null): Promise<string[]>;
}

export abstract class RolePermissionRepository {
  /** devolve false se a associação já existir */
  abstract attach(roleId: number, permissionId: number): Promise<boolean>;
  abstract detach(roleId: number, permissionId: number): Promise<boolean>;
}

/** Permissões dadas directamente a um utilizador, somadas às do perfil (nunca retiram). */
export abstract class UserPermissionRepository {
  abstract grantedSlugs(userId: number): Promise<string[]>;
  /** substitui a lista; devolve o que entrou e o que saiu */
  abstract replace(userId: number, slugs: string[], grantedById: number): Promise<{ added: string[]; removed: string[] }>;
  /** slugs do catálogo que existem e estão activos */
  abstract existingActive(slugs: string[]): Promise<string[]>;
}
