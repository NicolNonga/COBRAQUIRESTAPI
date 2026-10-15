import { VisibilityScope } from '@/shared/domain/criteria';

/**
 * Condições SQL de visibilidade por agente. `ph` é o marcador do parâmetro com o id do utilizador ($n ou :nome);
 * o valor vem de `scopeValue(scope)`.
 *
 *  - agente (SELF)  : só o que lhe está atribuído / que criou;
 *  - gestor (TEAM)  : o seu e o dos agentes da sua equipa (wallet_agents); vê também os processos ainda sem responsável,
 *                     porque é ele quem os distribui;
 *  - ALL            : permissão "Ver dados de todos os agentes".
 * Usa ux_process_assignments_process, ix_process_invoices_process e ux_wallet_agents_agent.
 */
export const scopeValue = (scope: VisibilityScope): number | null => (scope.kind === 'ALL' ? null : scope.kind === 'SELF' ? scope.userId : scope.managerId);

export const userInScopeSql = (col: string, scope: VisibilityScope, ph: string): string => {
  switch (scope.kind) {
    case 'ALL':
      return 'TRUE';
    case 'SELF':
      return `${col} = ${ph}`;
    case 'TEAM':
      return `(${col} = ${ph} OR ${col} IN (SELECT wa.agent_id FROM wallet_agents wa WHERE wa.manager_id = ${ph}))`;
  }
};

export const processVisibleSql = (processId: string, scope: VisibilityScope, ph: string): string => {
  if (scope.kind === 'ALL') return 'TRUE';
  const mine = `EXISTS (SELECT 1 FROM process_assignments vpa WHERE vpa.process_id = ${processId} AND ${userInScopeSql('vpa.user_id', scope, ph)})`;
  return scope.kind === 'SELF'
    ? mine
    : `(${mine} OR NOT EXISTS (SELECT 1 FROM process_assignments vpa0 WHERE vpa0.process_id = ${processId}))`;
};

export const invoiceVisibleSql = (invoiceId: string, createdById: string, scope: VisibilityScope, ph: string): string =>
  scope.kind === 'ALL'
    ? 'TRUE'
    : `(${userInScopeSql(createdById, scope, ph)}
        OR EXISTS (SELECT 1 FROM process_invoices vpi WHERE vpi.invoice_id = ${invoiceId} AND ${processVisibleSql('vpi.process_id', scope, ph)}))`;

export const negotiationVisibleSql = (negotiationId: string, createdById: string, scope: VisibilityScope, ph: string): string =>
  scope.kind === 'ALL'
    ? 'TRUE'
    : `(${userInScopeSql(createdById, scope, ph)}
        OR EXISTS (SELECT 1 FROM negotiation_processes vnp WHERE vnp.negotiation_id = ${negotiationId} AND ${processVisibleSql('vnp.process_id', scope, ph)}))`;
