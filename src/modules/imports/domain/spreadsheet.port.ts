export interface SheetRow {
  rowNumber: number;
  values: Record<string, string>;
}

export interface RowError {
  rowNumber: number;
  errors: string[];
  /** identificação alternativa da linha (p.ex. nome do PDF) */
  label?: string;
}

export abstract class SpreadsheetReader {
  /** lê a 1.ª folha; chaves normalizadas (minúsculas, sem acentos/espaços extra) */
  abstract read(buffer: Buffer, maxRows: number): Promise<SheetRow[]>;
  /** conteúdo "tal como está" (cabeçalhos originais) para pré-visualizar o ficheiro no browser */
  abstract preview(buffer: Buffer, maxRows: number): Promise<SheetPreview>;
}

export interface SheetPreview {
  sheetName: string;
  headers: string[];
  rows: Array<{ rowNumber: number; cells: string[] }>;
  totalRows: number;
  truncated: boolean;
}

export abstract class ImportErrorReportWriter {
  /** gera cópia do ficheiro com linhas a vermelho e coluna ERROS; devolve caminho relativo */
  abstract write(original: Buffer, errors: RowError[], prefix: string): Promise<string>;
}

export abstract class PdfTextExtractor {
  abstract extract(buffer: Buffer): Promise<string>;
}

export interface ImportSummary {
  total: number;
  imported: number;
  failed: number;
  errors: RowError[];
  errorReport?: string;
}

export const normalizeHeader = (h: string): string =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_\-/]+/g, ' ').trim();

/** obtém o 1.º valor não vazio entre vários cabeçalhos alternativos */
export const pick = (row: SheetRow, ...headers: string[]): string => {
  for (const h of headers) {
    const v = row.values[normalizeHeader(h)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};
