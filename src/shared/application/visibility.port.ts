import { VisibilityScope } from '@/shared/domain/criteria';

export type VisibleResource = 'process' | 'invoice' | 'negotiation' | 'agent';

/** Confirma, na BD, que o utilizador pode ver TODOS os registos pedidos (os que não existem contam como invisíveis). */
export abstract class VisibilityChecker {
  abstract allVisible(resource: VisibleResource, scope: VisibilityScope, ids: number[]): Promise<boolean>;
}
