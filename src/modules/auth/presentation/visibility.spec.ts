import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { resolveTeamScope } from '@/shared/application/team-scope';
import { VisibilityChecker } from '@/shared/application/visibility.port';
import { NotFoundError } from '@/shared/domain/errors';
import { invoiceVisibleSql, processVisibleSql, userInScopeSql } from '@/infrastructure/database/visibility.sql';
import { VisibilityGuard } from './visibility.guard';
import { fromBody, fromParam } from './visible-to.decorator';

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({ id: 7, email: 'a@b.ao', roleId: 1, organizationId: 1, isManager: false, permissions: [], ...over });

describe('âmbito de visibilidade', () => {
  it('agente vê só o seu; gestor a equipa; "ver todos" sobrepõe-se', () => {
    expect(resolveTeamScope(user(), P.AGENTS_VIEW_ALL)).toEqual({ kind: 'SELF', userId: 7 });
    expect(resolveTeamScope(user({ isManager: true }), P.AGENTS_VIEW_ALL)).toEqual({ kind: 'TEAM', managerId: 7 });
    expect(resolveTeamScope(user({ permissions: [P.AGENTS_VIEW_ALL] }), P.AGENTS_VIEW_ALL)).toEqual({ kind: 'ALL' });
  });

  it('SQL: SELF filtra pelo utilizador; TEAM inclui a equipa e os processos sem responsável; ALL não filtra', () => {
    expect(userInScopeSql('x.u', { kind: 'SELF', userId: 7 }, '$1')).toBe('x.u = $1');
    expect(userInScopeSql('x.u', { kind: 'TEAM', managerId: 7 }, '$1')).toContain('wallet_agents');
    expect(processVisibleSql('p.id', { kind: 'ALL' }, '$1')).toBe('TRUE');
    expect(processVisibleSql('p.id', { kind: 'SELF', userId: 7 }, '$1')).not.toContain('NOT EXISTS');
    expect(processVisibleSql('p.id', { kind: 'TEAM', managerId: 7 }, '$1')).toContain('NOT EXISTS');
    expect(invoiceVisibleSql('i.id', 'i.created_by', { kind: 'SELF', userId: 7 }, '$1')).toContain('process_invoices');
  });
});

describe('VisibilityGuard', () => {
  const ctx = (me: AuthenticatedUser | undefined, req: object) =>
    ({ getHandler: () => 'h', switchToHttp: () => ({ getRequest: () => ({ user: me, ...req }) }) }) as unknown as ExecutionContext;
  const guard = (meta: unknown, visible: boolean) => {
    const calls: unknown[][] = [];
    const checker = { allVisible: async (...a: unknown[]) => (calls.push(a), visible) } as unknown as VisibilityChecker;
    const reflector = { get: () => meta } as unknown as Reflector;
    return { g: new VisibilityGuard(reflector, checker), calls };
  };

  it('sem decorador não faz nada', async () => {
    expect(await guard(undefined, false).g.canActivate(ctx(user(), {}))).toBe(true);
  });
  it('"ver todos" passa sem consultar a BD', async () => {
    const { g, calls } = guard({ resource: 'process', ids: fromParam('id') }, false);
    expect(await g.canActivate(ctx(user({ permissions: [P.AGENTS_VIEW_ALL] }), { params: { id: '9' } }))).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it('registo de outro agente → 404', async () => {
    const { g, calls } = guard({ resource: 'process', ids: fromParam('id') }, false);
    await expect(g.canActivate(ctx(user(), { params: { id: '9' } }))).rejects.toBeInstanceOf(NotFoundError);
    expect(calls[0]).toEqual(['process', { kind: 'SELF', userId: 7 }, [9]]);
  });
  it('registo visível passa; ids inválidos são ignorados', async () => {
    const { g } = guard({ resource: 'process', ids: fromBody('processes', 'id') }, true);
    expect(await g.canActivate(ctx(user(), { body: { processes: [{ id: 3 }, { id: 'x' }] } }))).toBe(true);
  });
});
