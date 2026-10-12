/**
 * Diferença entre dois estados de um registo, para a auditoria.
 * Devolve só os campos que mudaram: { before: { email: "a@x" }, after: { email: "b@x" } }.
 */
const IGNORED = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash', 'tokenVersion', 'version']);

const norm = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))) return String(Number(v));
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

export interface AuditDiff {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedFields: string[];
}

export function auditDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): AuditDiff {
  const b = before ?? {};
  const a = after ?? {};
  const changed = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !IGNORED.has(k) && norm(b[k]) !== norm(a[k]));
  return {
    before: Object.fromEntries(changed.map((k) => [k, b[k] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, a[k] ?? null])),
    changedFields: changed,
  };
}

/** junta campos de um registo filho com prefixo: { name } → { contactName } */
export const prefixed = (prefix: string, row: Record<string, unknown> | null): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(row ?? {})
      .filter(([k]) => !IGNORED.has(k) && !k.endsWith('Id')) // chaves do pai (debtorId…) não interessam
      .map(([k, v]) => [prefix + k[0].toUpperCase() + k.slice(1), v]),
  );
