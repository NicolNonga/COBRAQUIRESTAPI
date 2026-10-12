import { StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';

/** Resposta de download de um PDF gerado no servidor. */
export const pdfResponse = (pdf: Buffer, name: string): StreamableFile => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda' }).format(new Date());
  return new StreamableFile(pdf, { type: 'application/pdf', disposition: `attachment; filename="${name}_${today}.pdf"`, length: pdf.length });
};

/** Quem gerou o documento (nome, ou email se não tiver nome). */
export const exportUserName = async (ds: DataSource, me: AuthenticatedUser): Promise<string> => {
  const [u] = await ds.query('SELECT coalesce(full_name, email) AS name FROM users WHERE id = $1', [me.id]);
  return u?.name ?? me.email;
};

const TABLES = { organizations: 'organizations', debtors: 'debtors', users: 'users' } as const;
/** Nome legível de um filtro por id (credor, devedor, utilizador). */
export const entityName = async (ds: DataSource, kind: keyof typeof TABLES, id: number | undefined): Promise<string | null> => {
  if (!id) return null;
  const col = kind === 'users' ? 'coalesce(full_name, email)' : 'name';
  const [r] = await ds.query(`SELECT ${col} AS name FROM ${TABLES[kind]} WHERE id = $1`, [id]);
  return r?.name ?? `#${id}`;
};

const fmtDay = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
/** "01/09/2026 a 30/09/2026" (ou só um dos extremos) */
export const rangeLabel = (from?: string, to?: string): string | null => (from && to ? `${fmtDay(from)} a ${fmtDay(to)}` : from ? `desde ${fmtDay(from)}` : to ? `até ${fmtDay(to)}` : null);

/** Mantém só os filtros com valor (a lista mostrada no cabeçalho do PDF). */
export const activeFilters = (pairs: Array<[string, string | null | undefined | false]>): Array<[string, string]> =>
  pairs.filter((p): p is [string, string] => !!p[1]);

export const yesNo = (v: boolean | undefined, yes: string, no: string) => (v === undefined ? null : v ? yes : no);
