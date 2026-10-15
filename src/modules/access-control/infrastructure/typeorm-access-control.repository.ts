import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Not } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { buildPage, offsetOf, Page, PageRequest } from '@/shared/domain/pagination';
import {
  Permission,
  PermissionRepository,
  Role,
  RolePermissionRepository,
  RoleRepository,
  UserPermissionRepository,
} from '../domain/access-control.repository';
import { PermissionOrmEntity, RoleOrmEntity } from './access-control.orm-entities';

@Injectable()
export class TypeOrmRoleRepository extends BaseTypeOrmRepository implements RoleRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  findById(id: number): Promise<Role | null> {
    return this.repo(RoleOrmEntity).findOneBy({ id });
  }

  async existsByName(name: string, exceptId?: number): Promise<boolean> {
    const qb = this.repo(RoleOrmEntity).createQueryBuilder('r').where('lower(r.name) = lower(:name)', { name });
    if (exceptId) qb.andWhere('r.id <> :exceptId', { exceptId });
    return (await qb.getCount()) > 0;
  }

  async create(data: Pick<Role, 'slug' | 'name' | 'description' | 'isManager'>): Promise<Role> {
    return this.repo(RoleOrmEntity).save(this.repo(RoleOrmEntity).create(data));
  }

  async update(id: number, data: Partial<Role>): Promise<boolean> {
    const r = await this.repo(RoleOrmEntity).update({ id }, data);
    return (r.affected ?? 0) > 0;
  }

  /**
   * Paginação + relação N:N sem N+1 e sem o problema de LIMIT sobre JOIN:
   * 1) página de ids; 2) uma única query com as permissões desses perfis.
   */
  async paginateWithActivePermissions(req: PageRequest): Promise<Page<Role>> {
    const [roles, total] = await this.repo(RoleOrmEntity).findAndCount({
      order: { id: 'DESC' },
      skip: offsetOf(req),
      take: req.perPage,
    });
    if (roles.length) {
      const rows: Array<{ role_id: number } & PermissionOrmEntity> = await this.manager.query(
        `SELECT rp.role_id, p.id, p.slug, p.name, p.description, p.is_active AS "isActive"
           FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ANY($1) AND p.is_active`,
        [roles.map((r) => r.id)],
      );
      const byRole = new Map<number, Permission[]>();
      for (const { role_id, ...p } of rows) byRole.set(role_id, [...(byRole.get(role_id) ?? []), p]);
      roles.forEach((r) => (r.permissions = (byRole.get(r.id) ?? []) as PermissionOrmEntity[]));
    }
    return buildPage(roles, total, req);
  }

  listActive(filter: { excludeSlug?: string; onlyManagers?: boolean }): Promise<Role[]> {
    return this.repo(RoleOrmEntity).find({
      where: {
        isActive: true,
        ...(filter.excludeSlug ? { slug: Not(filter.excludeSlug) } : {}),
        ...(filter.onlyManagers ? { isManager: true } : {}),
      },
      order: { name: 'ASC' },
    });
  }
}

@Injectable()
export class TypeOrmPermissionRepository extends BaseTypeOrmRepository implements PermissionRepository, RolePermissionRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  create(data: Pick<Permission, 'slug' | 'name' | 'description'>): Promise<Permission> {
    return this.repo(PermissionOrmEntity).save(this.repo(PermissionOrmEntity).create(data));
  }

  async setActive(id: number, active: boolean): Promise<boolean> {
    const r = await this.repo(PermissionOrmEntity).update({ id }, { isActive: active });
    return (r.affected ?? 0) > 0;
  }

  async paginate(req: PageRequest): Promise<Page<Permission>> {
    const [rows, total] = await this.repo(PermissionOrmEntity).findAndCount({
      order: { createdAt: 'DESC' },
      skip: offsetOf(req),
      take: req.perPage,
    });
    return buildPage(rows, total, req);
  }

  listActive(): Promise<Permission[]> {
    return this.repo(PermissionOrmEntity).find({ where: { isActive: true }, order: { name: 'ASC' } });
  }

  async activeSlugsForRole(roleId: number): Promise<string[]> {
    const rows: Array<{ slug: string }> = await this.manager.query(
      `SELECT p.slug FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id AND r.is_active
         JOIN permissions p ON p.id = rp.permission_id AND p.is_active
        WHERE rp.role_id = $1`,
      [roleId],
    );
    return rows.map((r) => r.slug);
  }

  async activeSlugsForUser(userId: number, roleId: number | null): Promise<string[]> {
    const rows: Array<{ slug: string }> = await this.manager.query(
      `SELECT p.slug FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id AND r.is_active
         JOIN permissions p ON p.id = rp.permission_id AND p.is_active
        WHERE rp.role_id = $1
       UNION
       SELECT p.slug FROM user_permissions up
         JOIN permissions p ON p.id = up.permission_id AND p.is_active
        WHERE up.user_id = $2`,
      [roleId ?? 0, userId],
    );
    return rows.map((r) => r.slug);
  }

  /** INSERT … ON CONFLICT DO NOTHING: idempotente e livre de race condition. */
  async attach(roleId: number, permissionId: number): Promise<boolean> {
    const rows: unknown[] = await this.manager.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
       ON CONFLICT (role_id, permission_id) DO NOTHING RETURNING role_id`,
      [roleId, permissionId],
    );
    return rows.length > 0;
  }

  async detach(roleId: number, permissionId: number): Promise<boolean> {
    const [, affected]: [unknown, number] = await this.manager.query(
      'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
      [roleId, permissionId],
    );
    return affected > 0;
  }

  async idsExist(ids: number[]): Promise<boolean> {
    return (await this.repo(PermissionOrmEntity).countBy({ id: In(ids) })) === ids.length;
  }
}

@Injectable()
export class TypeOrmUserPermissionRepository extends BaseTypeOrmRepository implements UserPermissionRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async grantedSlugs(userId: number): Promise<string[]> {
    const rows: Array<{ slug: string }> = await this.manager.query(
      `SELECT p.slug FROM user_permissions up JOIN permissions p ON p.id = up.permission_id AND p.is_active WHERE up.user_id = $1 ORDER BY p.slug`,
      [userId],
    );
    return rows.map((r) => r.slug);
  }

  async existingActive(slugs: string[]): Promise<string[]> {
    if (!slugs.length) return [];
    const rows: Array<{ slug: string }> = await this.manager.query('SELECT slug FROM permissions WHERE is_active AND slug = ANY($1)', [slugs]);
    return rows.map((r) => r.slug);
  }

  async replace(userId: number, slugs: string[], grantedById: number): Promise<{ added: string[]; removed: string[] }> {
    const before = new Set(await this.grantedSlugs(userId));
    const want = new Set(slugs);
    const removed = [...before].filter((s) => !want.has(s));
    const added = [...want].filter((s) => !before.has(s));
    if (removed.length) {
      await this.manager.query('DELETE FROM user_permissions WHERE user_id = $1 AND permission_id IN (SELECT id FROM permissions WHERE slug = ANY($2))', [userId, removed]);
    }
    if (added.length) {
      await this.manager.query(
        `INSERT INTO user_permissions (user_id, permission_id, granted_by_id)
         SELECT $1, p.id, $3 FROM permissions p WHERE p.slug = ANY($2) ON CONFLICT DO NOTHING`,
        [userId, added, grantedById],
      );
    }
    return { added, removed };
  }
}
