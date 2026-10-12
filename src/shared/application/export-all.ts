/** Tecto de segurança da exportação: na prática saem todas as linhas dos filtros. */
export const EXPORT_MAX_ROWS = 100_000;
const PER_PAGE = 500;

interface PageLike<T> {
  data: T[];
  meta: { total: number; lastPage: number };
}

/**
 * Percorre a listagem existente (mesmos filtros, permissões e âmbito da equipa) página a página
 * até ao limite — a exportação nunca mostra mais do que o utilizador já pode ver no ecrã.
 */
export async function collectAllPages<T>(fetchPage: (page: number, perPage: number) => Promise<PageLike<T>>): Promise<{ rows: T[]; total: number; truncated: boolean }> {
  const first = await fetchPage(1, PER_PAGE);
  const rows = [...first.data];
  const maxPages = Math.ceil(EXPORT_MAX_ROWS / PER_PAGE);
  for (let p = 2; p <= Math.min(first.meta.lastPage, maxPages); p++) rows.push(...(await fetchPage(p, PER_PAGE)).data);
  return { rows: rows.slice(0, EXPORT_MAX_ROWS), total: first.meta.total, truncated: first.meta.total > EXPORT_MAX_ROWS };
}
