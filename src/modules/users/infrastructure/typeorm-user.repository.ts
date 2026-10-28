import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { ConflictError } from '@/shared/domain/errors';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { applyCriteria } from '@/infrastructure/database/criteria/query-builder.adapter';
import { Criteria } from '@/shared/domain/criteria';
import { buildPage, offsetOf, Page, PageRequest } from '@/shared/domain/pagination';
import {
  AuthSnapshot,
  NewUser,
  TeamRepository,
  User,
  UserCredentials,
  UserField,
  UserQueries,
  UserRepository,
} from '../domain/user.repository';
import { UserOrmEntity, WalletAgentOrmEntity } from './user.orm-entities';

const USER_FIELDS = new CriteriaCompiler<UserField>({
  fullName: { column: 'u.full_name', searchable: true },
  email: { column: 'u.email' },
  roleId: { column: 'u.role_id', type: 'number' },
  organizationId: { column: 'u.organization_id', type: 'number' },
  categoryId: { column: 'u.category_id', type: 'number' },
  isActive: { column: 'u.is_active', type: 'boolean' },
  createdAt: { column: 'u.created_at', type: 'date' },
});

@Injectable()
export class TypeOrmUserRepository extends BaseTypeOrmRepository implements UserRepository, UserQueries, TeamRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  private get users() {
    return this.repo(UserOrmEntity);
  }

  async create(data: NewUser): Promise<User> {
    try {
      Logger.warn(data.passwordHash)
      return await this.users.save(this.users.create(data));
    } catch (e) {
      if (isUniqueViolation(e, 'ux_users_email')) throw new ConflictError('Já existe um utilizador com este email');
      if (isUniqueViolation(e, 'ux_users_phone_number')) throw new ConflictError('Já existe um utilizador com este telefone');
      throw e;
    }
  }

  async update(id: number, data: Partial<User>): Promise<boolean> {
    try {
      return ((await this.users.update({ id }, data)).affected ?? 0) > 0;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError('Email ou telefone já em uso');
      throw e;
    }
  }

  findById(id: number): Promise<User | null> {
    return this.users.findOne({ where: { id }, relations: { role: true, organization: true, category: true } });
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    return this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.passwordHash', 'u.isActive', 'u.tokenVersion'])
      .where('lower(u.email) = lower(:email)', { email }) // índice funcional ux_users_email
      .getOne();
  }

  findCredentialsById(id: number): Promise<UserCredentials | null> {
    return this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.passwordHash', 'u.isActive', 'u.tokenVersion'])
      .where('u.id = :id', { id })
      .getOne();
  }

  /** Uma query (JOIN) em vez de user + role em separado — executada a cada pedido autenticado. */
  async findAuthSnapshot(id: number): Promise<AuthSnapshot | null> {
    const [row] = await this.manager.query(
      `SELECT u.id, u.email, u.is_active AS "isActive", u.token_version AS "tokenVersion",
              u.role_id AS "roleId", u.organization_id AS "organizationId",
              COALESCE(r.is_active, false) AS "roleActive", COALESCE(r.is_manager, false) AS "isManager"
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1`,
      [id],
    );
    return row ?? null;
  }

  async setPassword(id: number, passwordHash: string, opts: { firstAccess?: boolean } = {}): Promise<void> {
    await this.manager.query(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1,
              first_access = COALESCE($3, first_access), updated_at = now()
        WHERE id = $1`,
      [id, passwordHash, opts.firstAccess ?? null],
    );
  }

  async setPasswordByEmail(email: string, passwordHash: string): Promise<boolean> {
    const [, affected] = await this.manager.query(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now()
        WHERE lower(email) = lower($1) AND is_active`,
      [email, passwordHash],
    );
    return affected > 0;
  }

  async managerOf(agentId: number): Promise<number | null> {
    const [r] = await this.manager.query('SELECT manager_id FROM wallet_agents WHERE agent_id = $1', [agentId]);
    return r?.manager_id ?? null;
  }

  async bumpTokenVersion(id: number): Promise<void> {
    await this.manager.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
  }

  async findDetailedWithPermissions(id: number): Promise<(User & { permissions: string[] }) | null> {
    const user = await this.findById(id);
    if (!user) return null;
    const perms: Array<{ slug: string }> = await this.manager.query(
      `SELECT p.slug FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id AND r.is_active
         JOIN permissions p ON p.id = rp.permission_id AND p.is_active
        WHERE rp.role_id = $1
       UNION
       SELECT p.slug FROM user_permissions up JOIN permissions p ON p.id = up.permission_id AND p.is_active WHERE up.user_id = $2`,
      [user.roleId ?? 0, id],
    );
    return Object.assign(user, { permissions: perms.map((p) => p.slug) });
  }

  // ---------- UserQueries ----------

  /**
   * ManyToOne (role/organization/category) via LEFT JOIN — 1 query + count.
   * As permissões de cada perfil são carregadas numa única query IN (sem N+1).
   */
  async search(criteria: Criteria<UserField>): Promise<Page<User>> {
    const qb = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.role', 'role')
      .leftJoinAndSelect('u.organization', 'organization')
      .leftJoinAndSelect('u.category', 'category');
    const [rows, total] = await applyCriteria(qb, USER_FIELDS, criteria, 'u.id').getManyAndCount();
    const req = { page: criteria.page, perPage: criteria.perPage };
    const roleIds = [...new Set(rows.map((u) => u.roleId).filter((x): x is number => !!x))];
    if (roleIds.length) {
      const perms: Array<{ role_id: number; id: number; slug: string; name: string }> = await this.manager.query(
        `SELECT rp.role_id, p.id, p.slug, p.name FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id AND p.is_active
          WHERE rp.role_id = ANY($1)`,
        [roleIds],
      );
      const byRole = new Map<number, typeof perms>();
      perms.forEach((p) => byRole.set(p.role_id, [...(byRole.get(p.role_id) ?? []), p]));
      rows.forEach((u) => u.role && Object.assign(u.role, { permissions: byRole.get(u.role.id) ?? [] }));
    }
    return buildPage(rows, total, req);
  }

  activeDropdown() {
    return this.users.find({ select: { id: true, fullName: true, email: true }, where: { isActive: true }, order: { fullName: 'ASC' } });
  }

  activeManagers() {
    return this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.fullName', 'u.email'])
      .innerJoin('u.role', 'r', 'r.is_manager = true AND r.is_active = true')
      .where('u.is_active = true')
      .orderBy('u.full_name', 'ASC')
      .getMany();
  }

  findInOrganization(userId: number, organizationId: number) {
    return this.users.findOne({ where: { id: userId, organizationId }, relations: { organization: true } });
  }

  // ---------- TeamRepository ----------

  async assignAgentToManager(agentId: number, managerId: number): Promise<void> {
    // upsert: um agente pertence a um único gestor (ux_wallet_agents_agent)
    await this.manager.query(
      `INSERT INTO wallet_agents (agent_id, manager_id) VALUES ($1, $2)
       ON CONFLICT (agent_id) DO UPDATE SET manager_id = EXCLUDED.manager_id`,
      [agentId, managerId],
    );
  }

  async paginateAgents(managerId: number, req: PageRequest): Promise<Page<User>> {
    const qb = this.users
      .createQueryBuilder('u')
      .innerJoin(WalletAgentOrmEntity, 'wa', 'wa.agent_id = u.id AND wa.manager_id = :managerId', { managerId })
      .leftJoinAndSelect('u.role', 'role')
      .leftJoinAndSelect('u.category', 'category')
      .leftJoinAndSelect('u.organization', 'organization')
      .where('u.is_active = true')
      .orderBy('u.full_name', 'ASC')
      .skip(offsetOf(req))
      .take(req.perPage);
    const [rows, total] = await qb.getManyAndCount();
    return buildPage(rows, total, req);
  }

  listAgents(managerId: number): Promise<User[]> {
    return this.users
      .createQueryBuilder('u')
      .innerJoin(WalletAgentOrmEntity, 'wa', 'wa.agent_id = u.id AND wa.manager_id = :managerId', { managerId })
      .leftJoinAndSelect('u.role', 'role')
      .where('u.is_active = true')
      .orderBy('u.full_name', 'ASC')
      .getMany();
  }
}
