import { Injectable, Logger } from '@nestjs/common';
import { InvoiceRepository } from '@/modules/invoices/domain/invoice.repository';
import { FileStorage, UploadedBinary } from '@/shared/application/file-storage.port';
import { PdfTextExtractor } from '../domain/spreadsheet.port';

const clean = (s: string) => s.replace(/[\s\-:]/g, '').toLowerCase();

export interface PdfMatchResult {
  file: string;
  matched: boolean;
  reference?: string;
  reason?: string;
}

/**
 * Associa PDFs às facturas pela referência + nome/NIF do devedor encontrados no texto.
 * Candidatas carregadas UMA vez (projecção mínima). Atribuição com
 * `WHERE document_path IS NULL` → dois uploads simultâneos não sobrescrevem.
 */
@Injectable()
export class AttachInvoicePdfsUseCase {
  private readonly logger = new Logger(AttachInvoicePdfsUseCase.name);

  constructor(private readonly invoices: InvoiceRepository, private readonly pdf: PdfTextExtractor, private readonly storage: FileStorage) {}

  async execute(files: UploadedBinary[]): Promise<PdfMatchResult[]> {
    const candidates = (await this.invoices.pdfCandidates()).map((c) => ({ ...c, ref: clean(c.referenceNumber) }));
    const used = new Set<number>();
    const results: PdfMatchResult[] = [];

    for (const f of files) {
      const raw = (await this.pdf.extract(f.buffer)).toLowerCase();
      const text = clean(raw);
      const inv = candidates.find((c) => !used.has(c.id) && c.ref && text.includes(c.ref));
      if (!inv) {
        results.push({ file: f.originalName, matched: false, reason: 'Referência não encontrada no PDF' });
        continue;
      }
      const nameOk = raw.includes(inv.debtorName.trim().toLowerCase());
      const nifOk = !!inv.debtorNif && raw.includes(inv.debtorNif.trim().toLowerCase());
      if (!nameOk || !nifOk) {
        results.push({ file: f.originalName, matched: false, reference: inv.referenceNumber, reason: 'Devedor não corresponde' });
        continue;
      }
      const path = await this.storage.save(f, 'invoices');
      if (await this.invoices.attachDocumentIfEmpty(inv.id, path)) {
        used.add(inv.id);
        results.push({ file: f.originalName, matched: true, reference: inv.referenceNumber });
      } else {
        await this.storage.remove(path);
        results.push({ file: f.originalName, matched: false, reference: inv.referenceNumber, reason: 'Factura já tem documento' });
      }
    }
    this.logger.log({ files: files.length, matched: results.filter((r) => r.matched).length }, 'Import de PDFs concluído');
    return results;
  }
}
