import { AuthenticatedUser } from './authenticated-user';

/**
 * Visibilidade por hierarquia (painel, tarefas da régua…):
 *  ALL  → quem tem a permissão de "ver tudo";
 *  TEAM → gestor: ele próprio + os agentes da sua carteira (wallet_agents);
 *  SELF → agente: só os seus números.
 */
export type TeamScope = { kind: 'ALL' } | { kind: 'TEAM'; managerId: number } | { kind: 'SELF'; userId: number };

export const resolveTeamScope = (me: AuthenticatedUser, viewAllPermission: string): TeamScope =>
  me.permissions.includes(viewAllPermission) ? { kind: 'ALL' } : me.isManager ? { kind: 'TEAM', managerId: me.id } : { kind: 'SELF', userId: me.id };
