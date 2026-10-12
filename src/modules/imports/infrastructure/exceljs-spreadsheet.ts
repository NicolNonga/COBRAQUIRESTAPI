import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { FileStorage } from '@/shared/application/file-storage.port';
import { ValidationError } from '@/shared/domain/errors';
import { ImportErrorReportWriter, normalizeHeader, RowError, SheetPreview, SheetRow, SpreadsheetReader } from '../domain/spreadsheet.port';

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && v.text !== undefined) return String(v.text);
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
  }
  return String(v);
};

@Injectable()
export class ExcelJsSpreadsheetReader extends SpreadsheetReader {
  async read(buffer: Buffer, maxRows: number): Promise<SheetRow[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new ValidationError('Folha de cálculo vazia');
    if (ws.actualRowCount - 1 > maxRows) throw new ValidationError(`O ficheiro excede o máximo de ${maxRows} linhas`);
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => (headers[col] = normalizeHeader(cellText(c.value))));
    const rows: SheetRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (c, col) => headers[col] && (values[headers[col]] = cellText(c.value).trim()));
      rows.push({ rowNumber, values });
    });
    return rows;
  }

  async preview(buffer: Buffer, maxRows: number): Promise<SheetPreview> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    if (!ws) return { sheetName: '', headers: [], rows: [], totalRows: 0, truncated: false };
    const width = ws.columnCount;
    const line = (row: ExcelJS.Row) => Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1).value).trim());
    const headers = line(ws.getRow(1));
    const rows: SheetPreview['rows'] = [];
    let totalRows = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      totalRows += 1;
      if (rows.length < maxRows) rows.push({ rowNumber, cells: line(row) });
    });
    return { sheetName: ws.name, headers, rows, totalRows, truncated: totalRows > rows.length };
  }
}

@Injectable()
export class ExcelJsErrorReportWriter extends ImportErrorReportWriter {
  constructor(private readonly storage: FileStorage) {
    super();
  }

  async write(original: Buffer, errors: RowError[], prefix: string): Promise<string> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(original as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    const col = ws.columnCount + 1;
    ws.getRow(1).getCell(col).value = 'ERROS';
    for (const e of errors) {
      const row = ws.getRow(e.rowNumber);
      row.eachCell({ includeEmpty: true }, (c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
      });
      row.getCell(col).value = e.errors.join('; ');
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return this.storage.save(
      { buffer: buf, originalName: `${prefix}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: buf.length },
      'import-errors',
    );
  }
}
