export interface AuditEntry {
  action: string; // ex.: 'NEGOTIATION_CREATED'
  entity: string; // ex.: 'negotiation'
  entityId?: string | number | null;
  payload?: Record<string, unknown>;
}

/**
 * Trilho de auditoria das operações financeiras. A escrita ocorre na MESMA
 * transacção da operação auditada: ou ficam ambas gravadas ou nenhuma.
 */
export abstract class AuditTrail {
  abstract record(entry: AuditEntry): Promise<void>;
  /**
   * Estado actual de um registo (colunas em camelCase), lido na transacção corrente.
   * Usado para guardar "antes" e "depois" nas edições. Só tabelas de AUDITED_TABLES.
   */
  abstract snapshot(table: AuditedTable, where: Record<string, number>): Promise<Record<string, unknown> | null>;
}

export const AUDITED_TABLES = [
  'debtors', 'debtor_contact_persons', 'invoices', 'users', 'roles', 'organizations', 'payment_methods', 'currencies', 'collection_ladders',
] as const;
export type AuditedTable = (typeof AUDITED_TABLES)[number];
