import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStateCode, ProcessStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { GenerationResult, ProcessCommandRepository } from '../domain/process.repository';

/** Cria/actualiza processos de cobrança a partir de facturas vencidas. Idempotente. */
@Injectable()
export class GenerateCollectionProcessesUseCase {
  private readonly logger = new Logger(GenerateCollectionProcessesUseCase.name);

  constructor(
    private readonly processes: ProcessCommandRepository,
    private readonly states: StateCatalog,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(): Promise<GenerationResult> {
    const overdue = await this.states.invoiceStateId(InvoiceStateCode.OVERDUE);
    // o processo nasce REGISTADO; passa a "Em cobrança" quando a cobrança arranca
    const registered = await this.states.processStateId(ProcessStateCode.REGISTERED);
    return this.uow.run(async () => {
      const r = await this.processes.generateFromOverdueInvoices(overdue, registered);
      if (r.invoicesLinked > 0) {
        await this.audit.record({ action: 'COLLECTION_PROCESSES_GENERATED', entity: 'process', payload: { ...r } });
        this.logger.log(r, 'Processos de cobrança gerados');
      }
      return r;
    });
  }
}
