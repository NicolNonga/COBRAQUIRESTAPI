import { Injectable } from '@nestjs/common';
import { InvoiceStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { FileStorage, UploadedBinary } from '@/shared/application/file-storage.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { InvoiceFactory } from '../domain/invoice';
import { InvoiceRepository } from '../domain/invoice.repository';

export interface CreateInvoiceInput {
  debtor_id: number;
  currency_id: number;
  refencence_number: string;
  amount: string;
  time_limit: number;
  issue_date: string;
  document?: UploadedBinary;
  userId: number;
}

@Injectable()
export class CreateInvoiceUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly states: StateCatalog,
    private readonly storage: FileStorage,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(input: CreateInvoiceInput): Promise<{ id: number }> {
    const stateId = await this.states.invoiceStateId(InvoiceStateCode.IN_PROGRESS);
    // valida regras ANTES de gravar o ficheiro
    const data = InvoiceFactory.build({
      referenceNumber: input.refencence_number,
      amount: input.amount,
      issueDate: input.issue_date,
      timeLimitDays: input.time_limit,
      debtorId: input.debtor_id,
      currencyId: input.currency_id,
      invoiceStateId: stateId,
      createdById: input.userId,
    });
    const documentPath = input.document ? await this.storage.save(input.document, 'invoices') : null;
    try {
      return await this.uow.run(async () => {
        // unicidade da referência garantida pelo índice único (sem SELECT prévio → sem race)
        const inv = await this.invoices.create({ ...data, documentPath });
        await this.audit.record({
          action: 'INVOICE_CREATED',
          entity: 'invoice',
          entityId: inv.id,
          payload: { referenceNumber: inv.referenceNumber, amount: inv.amount, debtorId: inv.debtorId, dueDate: inv.dueDate },
        });
        return { id: inv.id };
      });
    } catch (e) {
      if (documentPath) await this.storage.remove(documentPath);
      throw e;
    }
  }
}
