import { UploadedBinary } from '@/shared/application/file-storage.port';
import { ValidationError } from '@/shared/domain/errors';

export const toBinary = (f: Express.Multer.File): UploadedBinary => ({
  originalName: f.originalname,
  mimeType: f.mimetype,
  size: f.size,
  buffer: f.buffer,
});

const EXT = /\.([a-z0-9]+)$/i;

const startsWith = (b: Buffer, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
/** Assinatura ("magic bytes") real do conteúdo, por extensão: o nome e o mimetype vêm do cliente e são falsificáveis. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  pdf: (b) => b.subarray(0, 1024).includes('%PDF-'),
  xlsx: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) && b.includes('xl/workbook.xml'),
};

/** Valida extensão + mimetype + conteúdo real (a extensão sozinha não chega). */
export const assertFileType = (f: Express.Multer.File | undefined, allowed: Record<string, string[]>): void => {
  if (!f) return;
  const ext = EXT.exec(f.originalname)?.[1]?.toLowerCase() ?? '';
  const mimes = allowed[ext];
  if (!mimes || !mimes.includes(f.mimetype)) {
    throw new ValidationError(`Tipo de ficheiro não permitido (${ext || 'sem extensão'})`);
  }
  const isGenuine = SIGNATURES[ext];
  if (!isGenuine || !f.buffer || !isGenuine(f.buffer)) {
    throw new ValidationError('O conteúdo do ficheiro não corresponde ao tipo indicado. Envie o ficheiro original (PDF, PNG, JPG ou XLSX).');
  }
};

export const IMAGE_TYPES = { png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'] };
export const PDF_TYPES = { pdf: ['application/pdf'] };
export const EXCEL_TYPES = {
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
};
