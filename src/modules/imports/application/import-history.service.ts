import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { FileStorage } from '@/shared/application/file-storage.port';
import { DomainError, NotFoundError, ValidationError } from '@/shared/domain/errors';
import { ImportSummary, RowError, SheetPreview, SpreadsheetReader } from '../domain/spreadsheet.port';

export type ImportKind = 'ORGANIZATIONS' | 'DEBTORS' | 'INVOICES' | 'INVOICE_PDFS';
export type ImportStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
export const IMPORT_KINDS: ImportKind[] = ['ORGANIZATIONS', 'DEBTORS', 'INVOICES', 'INVOICE_PDFS'];
export const IMPORT_STATUSES: ImportStatus[] = ['SUCCESS', 'PARTIAL', 'FAILED'];

export interface ImportSource {
  kind: ImportKind;
  fileName: string;
  size: number;
  /** ficheiro original (Excel) — guardado para consulta posterior; PDFs não são guardados aqui */
  buffer?: Buffer;
  userId: number | null;
}

export interface ImportBatchRow {
  id: number;
  kind: ImportKind;
  status: ImportStatus;
  fileName: string;
  fileSize: number;
  hasFile: boolean;
  hasErrorReport: boolean;
  total: number;
  imported: number;
  failed: number;
  message: string | null;
  durationMs: number | null;
  createdById: number | null;
  createdByName: string | null;
  createdAt: string;
}

const SELECT = `
  SELECT b.id, b.kind, b.status, b.file_name AS "fileName", b.file_size AS "fileSize",
         (b.file_path IS NOT NULL) AS "hasFile", (b.error_report_path IS NOT NULL) AS "hasErrorReport",
         b.total, b.imported, b.failed, b.message, b.duration_ms AS "durationMs",
         b.created_by_id AS "createdById", coalesce(u.full_name, u.email) AS "createdByName", b.created_at AS "createdAt"
    FROM import_batches b
    LEFT JOIN users u ON u.id = b.created_by_id`;

/**
 * Regista cada importação (ficheiro original + resultado + erros por linha) e serve o histórico.
 * O registo é feito fora da transacção da importação: mesmo que a importação falhe, fica a tentativa.
 */
@Injectable()
export class ImportHistoryService {
  private readonly logger = new Logger(ImportHistoryService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly storage: FileStorage,
    private readonly reader: SpreadsheetReader,
  ) {}

  /** Corre a importação e guarda o resultado (ou a falha) no histórico. Devolve o resumo + id do registo. */
  async track<T extends ImportSummary>(src: ImportSource, run: () => Promise<T>): Promise<T & { batchId: number | null }> {
    const started = Date.now();
    const filePath = src.buffer ? await this.saveOriginal(src) : null;
    try {
      const r = await run();
      const status: ImportStatus = r.total === 0 || r.imported === 0 ? 'FAILED' : r.failed > 0 ? 'PARTIAL' : 'SUCCESS';
      const message = r.total === 0 ? 'O ficheiro não tem linhas para importar' : null;
      const batchId = await this.insert(src, filePath, Date.now() - started, {
        status, total: r.total, imported: r.imported, failed: r.failed, errors: r.errors ?? [], errorReport: r.errorReport ?? null, message,
      });
      return { ...r, batchId };
    } catch (err) {
      const message = err instanceof DomainError ? err.message : 'Ocorreu um erro inesperado ao processar o ficheiro';
      await this.insert(src, filePath, Date.now() - started, { status: 'FAILED', total: 0, imported: 0, failed: 0, errors: [], errorReport: null, message });
      throw err;
    }
  }

  private async saveOriginal(src: ImportSource): Promise<string | null> {
    try {
      return await this.storage.save(
        { buffer: src.buffer!, originalName: src.fileName, mimeType: 'application/octet-stream', size: src.size },
        'imports',
      );
    } catch (e) {
      // não bloquear a importação por causa do histórico
      this.logger.warn({ err: e }, 'Não foi possível guardar o ficheiro original da importação');
      return null;
    }
  }

  private async insert(
    src: ImportSource, filePath: string | null, durationMs: number,
    r: { status: ImportStatus; total: number; imported: number; failed: number; errors: RowError[]; errorReport: string | null; message: string | null },
  ): Promise<number | null> {
    try {
      const [row] = (await this.ds.query(
        `INSERT INTO import_batches (kind, status, file_name, file_size, file_path, error_report_path, total, imported, failed, errors, message, duration_ms, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) RETURNING id`,
        [src.kind, r.status, src.fileName.slice(0, 255), src.size, filePath, r.errorReport, r.total, r.imported, r.failed,
          JSON.stringify(r.errors), r.message, durationMs, src.userId],
      )) as Array<{ id: number }>;
      return row.id;
    } catch (e) {
      this.logger.error({ err: e }, 'Falha ao registar importação no histórico');
      return null;
    }
  }

  async list(q: { page: number; perPage: number; kind?: ImportKind; status?: ImportStatus; userId?: number; search?: string; from?: string; to?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.kind) where.push(`b.kind = ${p(q.kind)}`);
    if (q.status) where.push(`b.status = ${p(q.status)}`);
    if (q.userId) where.push(`b.created_by_id = ${p(q.userId)}`);
    if (q.from) where.push(`b.created_at >= ${p(q.from)}::date`);
    if (q.to) where.push(`b.created_at < ${p(q.to)}::date + 1`);
    if (q.search) {
      const s = p(`%${q.search.trim()}%`);
      where.push(`(b.file_name ILIKE ${s} OR u.full_name ILIKE ${s} OR u.email ILIKE ${s})`);
    }
    const rows = (await this.ds.query(
      `${SELECT.replace('FROM import_batches b', ', count(*) OVER () AS "_total" FROM import_batches b')}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT ${p(q.perPage)} OFFSET ${p((q.page - 1) * q.perPage)}`,
      params,
    )) as Array<ImportBatchRow & { _total: string }>;
    const total = rows.length ? Number(rows[0]._total) : 0;
    return {
      meta: { total, perPage: q.perPage, currentPage: q.page, lastPage: Math.max(1, Math.ceil(total / q.perPage)), firstPage: 1 },
      data: rows.map(({ _total, ...r }) => r),
    };
  }

  async stats() {
    const [r] = await this.ds.query(`
      SELECT count(*)::int AS batches,
             coalesce(sum(imported), 0)::int AS imported,
             coalesce(sum(failed), 0)::int AS failed,
             count(*) FILTER (WHERE status <> 'SUCCESS')::int AS "withErrors"
        FROM import_batches WHERE created_at >= now() - interval '30 days'`);
    return r as { batches: number; imported: number; failed: number; withErrors: number };
  }

  async get(id: number): Promise<ImportBatchRow & { errors: RowError[] }> {
    const [row] = (await this.ds.query(`${SELECT.replace('FROM import_batches b', ', b.errors FROM import_batches b')} WHERE b.id = $1`, [id])) as Array<
      ImportBatchRow & { errors: RowError[] }
    >;
    if (!row) throw new NotFoundError('Importação não encontrada');
    return row;
  }

  private async paths(id: number) {
    const [row] = (await this.ds.query('SELECT file_name, file_path, error_report_path, kind FROM import_batches WHERE id = $1', [id])) as Array<{
      file_name: string; file_path: string | null; error_report_path: string | null; kind: ImportKind;
    }>;
    if (!row) throw new NotFoundError('Importação não encontrada');
    return row;
  }

  async originalFile(id: number) {
    const r = await this.paths(id);
    if (!r.file_path || !(await this.storage.exists(r.file_path))) throw new NotFoundError('O ficheiro original desta importação não está disponível');
    return { path: this.storage.absolutePath(r.file_path), fileName: r.file_name };
  }

  async errorReport(id: number) {
    const r = await this.paths(id);
    if (!r.error_report_path || !(await this.storage.exists(r.error_report_path))) throw new NotFoundError('Esta importação não tem relatório de erros');
    const base = r.file_name.replace(/\.[^.]+$/, '');
    return { path: this.storage.absolutePath(r.error_report_path), fileName: `${base}_erros.xlsx` };
  }

  /** Ficheiro original lido no servidor → tabela para ver no browser, com os erros de cada linha. */
  async preview(id: number, maxRows = 1000): Promise<SheetPreview & { errorsByRow: Record<number, string[]> }> {
    const r = await this.paths(id);
    if (r.kind === 'INVOICE_PDFS') throw new ValidationError('As importações de PDF não têm folha de cálculo para mostrar');
    const file = await this.originalFile(id);
    const sheet = await this.reader.preview(await readFile(file.path), maxRows);
    const batch = await this.get(id);
    const errorsByRow: Record<number, string[]> = {};
    for (const e of batch.errors) if (e.rowNumber) errorsByRow[e.rowNumber] = e.errors;
    return { ...sheet, errorsByRow };
  }
}
