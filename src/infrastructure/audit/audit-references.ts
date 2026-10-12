import { DataSource } from 'typeorm';

/**
 * Traduz ids guardados no payload da auditoria em nomes legíveis
 * (debtorId: 1 → "João Manuel"), para o ecrã de auditoria não mostrar "Debtor id 1".
 * Resolve em lote: 1 query por tipo de registo para a página inteira (sem N+1).
 */
type Kind =
  | 'debtor' | 'organization' | 'currency' | 'user' | 'role' | 'permission' | 'process' | 'invoice' | 'negotiation'
  | 'payment_method' | 'debtor_type' | 'category' | 'contact_type' | 'invoice_state' | 'process_state' | 'collection_ladder';

/** campo do payload → tipo de registo */
const FIELD_KIND: Record<string, Kind> = {
  debtorId: 'debtor', debtor_id: 'debtor', debtorIds: 'debtor',
  organizationId: 'organization', organization_id: 'organization',
  currencyId: 'currency', currency_id: 'currency',
  userId: 'user', user_id: 'user', toUserId: 'user', fromUserId: 'user', assignedUserId: 'user', managerId: 'user',
  createdById: 'user', registeredById: 'user', confirmedById: 'user', cancelledById: 'user', approvedById: 'user',
  performedById: 'user', ownerUserId: 'user',
  roleId: 'role', role_id: 'role', permissionId: 'permission', permission_id: 'permission',
  processId: 'process', processe_id: 'process', processIds: 'process', removedFromProcessId: 'process',
  invoiceId: 'invoice', invoiceIds: 'invoice',
  negotiationId: 'negotiation', negotiationIds: 'negotiation',
  paymentMethodId: 'payment_method', payment_method_id: 'payment_method',
  debtorTypeId: 'debtor_type', typeDebtor_id: 'debtor_type', categoryId: 'category', category_id: 'category',
  contactTypeId: 'contact_type', contact_type_id: 'contact_type',
  invoiceStateId: 'invoice_state', processStateId: 'process_state', ladderId: 'collection_ladder',
};

/** entidade do evento → tipo de registo (para mostrar "Factura FT 009483" em vez de "#5") */
const ENTITY_KIND: Record<string, Kind> = {
  debtor: 'debtor', organization: 'organization', currency: 'currency', user: 'user', role: 'role', permission: 'permission',
  process: 'process', invoice: 'invoice', negotiation: 'negotiation', payment_method: 'payment_method',
  contact_type: 'contact_type', collection_ladder: 'collection_ladder',
};

const SQL: Record<Kind, string> = {
  debtor: `SELECT id, name AS label FROM debtors WHERE id = ANY($1)`,
  organization: `SELECT id, name AS label FROM organizations WHERE id = ANY($1)`,
  currency: `SELECT id, name || ' (' || code || ')' AS label FROM currencies WHERE id = ANY($1)`,
  user: `SELECT id, coalesce(nullif(full_name, ''), email) AS label FROM users WHERE id = ANY($1)`,
  role: `SELECT id, name AS label FROM roles WHERE id = ANY($1)`,
  permission: `SELECT id, name AS label FROM permissions WHERE id = ANY($1)`,
  process: `SELECT p.id, 'PRC-' || lpad(p.id::text, 5, '0') || ' · ' || d.name AS label FROM processes p JOIN debtors d ON d.id = p.debtor_id WHERE p.id = ANY($1)`,
  invoice: `SELECT id, reference_number AS label FROM invoices WHERE id = ANY($1)`,
  negotiation: `SELECT n.id, 'NEG-' || lpad(n.id::text, 5, '0') AS label FROM negotiations n WHERE n.id = ANY($1)`,
  payment_method: `SELECT id, name AS label FROM payment_methods WHERE id = ANY($1)`,
  debtor_type: `SELECT id, name AS label FROM debtor_types WHERE id = ANY($1)`,
  category: `SELECT id, name AS label FROM categories WHERE id = ANY($1)`,
  contact_type: `SELECT id, name AS label FROM contact_types WHERE id = ANY($1)`,
  invoice_state: `SELECT id, name AS label FROM invoice_states WHERE id = ANY($1)`,
  process_state: `SELECT id, name AS label FROM process_states WHERE id = ANY($1)`,
  collection_ladder: `SELECT id, name AS label FROM collection_ladders WHERE id = ANY($1)`,
};

const asIds = (v: unknown): number[] =>
  (Array.isArray(v) ? v : [v]).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0 && n < 2 ** 31);

interface Row { entity: string; entityId: string | null; payload: Record<string, unknown> | null }
/** prefixos onde procurar ids: topo do payload e blocos before/after */
const scopes = (p: Record<string, unknown>) =>
  [['', p], ['before.', p.before], ['after.', p.after]].filter(([, o]) => o && typeof o === 'object' && !Array.isArray(o)) as Array<[string, Record<string, unknown>]>;

export async function resolveAuditReferences<T extends Row>(ds: DataSource, rows: T[]): Promise<Array<T & { entityLabel: string | null; references: Record<string, string> }>> {
  const wanted = new Map<Kind, Set<number>>();
  const want = (k: Kind, ids: number[]) => ids.forEach((id) => (wanted.get(k) ?? wanted.set(k, new Set()).get(k)!).add(id));

  for (const r of rows) {
    const ek = ENTITY_KIND[r.entity];
    if (ek && r.entityId) want(ek, asIds(r.entityId));
    for (const [, obj] of r.payload ? scopes(r.payload) : []) for (const [k, v] of Object.entries(obj)) if (FIELD_KIND[k]) want(FIELD_KIND[k], asIds(v));
  }

  const names = new Map<string, string>(); // "debtor:1" → "João Manuel"
  await Promise.all(
    [...wanted].map(async ([kind, ids]) => {
      try {
        const found: Array<{ id: number; label: string }> = await ds.query(SQL[kind], [[...ids]]);
        found.forEach((f) => names.set(`${kind}:${f.id}`, f.label));
      } catch {
        /* tabela/coluna ausente numa instalação antiga: mantém o id */
      }
    }),
  );
  const nameOf = (k: Kind, id: number) => names.get(`${k}:${id}`) ?? `Registo removido (#${id})`;

  return rows.map((r) => {
    const references: Record<string, string> = {};
    for (const [prefix, obj] of r.payload ? scopes(r.payload) : [])
      for (const [k, v] of Object.entries(obj)) {
        const kind = FIELD_KIND[k];
        const ids = kind ? asIds(v) : [];
        if (kind && ids.length) references[prefix + k] = ids.map((id) => nameOf(kind, id)).join(', ');
      }
    const ek = ENTITY_KIND[r.entity];
    const eid = r.entityId ? asIds(r.entityId)[0] : undefined;
    return { ...r, entityLabel: ek && eid ? names.get(`${ek}:${eid}`) ?? null : null, references };
  });
}
