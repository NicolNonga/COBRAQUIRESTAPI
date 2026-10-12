import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { FileStorage, UploadedBinary } from '@/shared/application/file-storage.port';
import { BusinessRuleError, NotFoundError } from '@/shared/domain/errors';
import { InvoiceRepository } from '../domain/invoice.repository';

/** PDF da factura: consultar/descarregar e anexar quando foi registada sem documento. */
@Injectable()
export class InvoiceDocumentUseCases {
  constructor(private readonly invoices: InvoiceRepository, private readonly storage: FileStorage, private readonly audit: AuditTrail) {}

  async file(id: number): Promise<{ path: string; fileName: string }> {
    const inv = await this.invoices.documentOf(id);
    if (!inv) throw new NotFoundError('Factura não encontrada');
    if (!inv.documentPath) throw new NotFoundError('Esta factura não tem PDF anexado');
    if (!(await this.storage.exists(inv.documentPath))) throw new NotFoundError('O PDF desta factura já não está disponível no arquivo');
    const safeRef = inv.referenceNumber.replace(/[^\w.-]+/g, '_');
    return { path: this.storage.absolutePath(inv.documentPath), fileName: `Factura_${safeRef}.pdf` };
  }

  async attach(id: number, doc: UploadedBinary): Promise<void> {
    const inv = await this.invoices.documentOf(id);
    if (!inv) throw new NotFoundError('Factura não encontrada');
    if (inv.documentPath) throw new BusinessRuleError('Esta factura já tem um PDF anexado');
    const path = await this.storage.save(doc, 'invoices');
    if (!(await this.invoices.attachDocumentIfEmpty(id, path))) {
      await this.storage.remove(path);
      throw new BusinessRuleError('Esta factura já tem um PDF anexado');
    }
    await this.audit.record({ action: 'INVOICE_DOCUMENT_ATTACHED', entity: 'invoice', entityId: id, payload: { fileName: doc.originalName } });
  }
}
