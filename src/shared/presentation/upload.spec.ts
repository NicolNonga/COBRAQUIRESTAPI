import { assertFileType, EXCEL_TYPES, IMAGE_TYPES, PDF_TYPES } from './upload';

const file = (originalname: string, mimetype: string, buffer: Buffer) => ({ originalname, mimetype, buffer, size: buffer.length }) as Express.Multer.File;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('assertFileType (conteúdo real)', () => {
  it('aceita ficheiros genuínos', () => {
    expect(() => assertFileType(file('a.png', 'image/png', PNG), IMAGE_TYPES)).not.toThrow();
    expect(() => assertFileType(file('a.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n...')), PDF_TYPES)).not.toThrow();
    const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml')]);
    expect(() => assertFileType(file('a.xlsx', 'application/octet-stream', xlsx), EXCEL_TYPES)).not.toThrow();
  });

  it('rejeita executável disfarçado de PDF/imagem/Excel', () => {
    const exe = Buffer.from('MZ\x90\x00 programa');
    expect(() => assertFileType(file('a.pdf', 'application/pdf', exe), PDF_TYPES)).toThrow(/conteúdo/);
    expect(() => assertFileType(file('a.png', 'image/png', exe), IMAGE_TYPES)).toThrow(/conteúdo/);
    expect(() => assertFileType(file('a.xlsx', 'application/octet-stream', Buffer.from('PK\x03\x04 zip qualquer')), EXCEL_TYPES)).toThrow(/conteúdo/);
  });

  it('rejeita extensão ou mimetype fora da lista', () => {
    expect(() => assertFileType(file('a.exe', 'application/x-msdownload', PNG), IMAGE_TYPES)).toThrow(/não permitido/);
    expect(() => assertFileType(file('a.png', 'text/html', PNG), IMAGE_TYPES)).toThrow(/não permitido/);
  });
});
