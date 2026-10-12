import { TeamScope } from '@/shared/application/team-scope';

/**
 * Condição SQL para limitar uma coluna "agente" ao âmbito do utilizador.
 * `param` é o índice posicional a usar ($n). Devolve o fragmento e o valor do parâmetro (ou nenhum).
 * Usa ux_wallet_agents_agent / ix_wallet_agents_manager.
 */
export const teamScopeSql = (agentColumn: string, scope: TeamScope, param: number): { sql: string; params: unknown[] } => {
  switch (scope.kind) {
    case 'ALL':
      return { sql: 'TRUE', params: [] };
    case 'SELF':
      return { sql: `${agentColumn} = $${param}`, params: [scope.userId] };
    case 'TEAM':
      return {
        sql: `(${agentColumn} = $${param} OR ${agentColumn} IN (SELECT wa.agent_id FROM wallet_agents wa WHERE wa.manager_id = $${param}))`,
        params: [scope.managerId],
      };
  }
};
