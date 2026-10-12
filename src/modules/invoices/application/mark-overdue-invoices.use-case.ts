import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { InvoiceRepository } from '../domain/invoice.repository';

/** Estados a partir dos quais uma factura pode passar a "vencida". */
const OPEN_STATES = [InvoiceStateCode.PENDING, InvoiceStateCode.IN_PROGRESS];

@Injectable()
export class MarkOverdueInvoicesUseCase {
  private readonly logger = new Logger(MarkOverdueInvoicesUseCase.name);

  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly states: StateCatalog,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {}

  /** Deve correr dentro de uma transacção (o job usa lock distribuído transaccional). */
  async execute(): Promise<number> {
    const overdueId = await this.states.invoiceStateId(InvoiceStateCode.OVERDUE);
    const openIds = await Promise.all(OPEN_STATES.map((c) => this.states.invoiceStateId(c)));
    const today = this.clock.now().toISOString().slice(0, 10);
    const n = await this.invoices.markOverdue(overdueId, openIds, today);
    if (n > 0) {
      await this.audit.record({ action: 'INVOICES_MARKED_OVERDUE', entity: 'invoice', payload: { count: n, today } });
      this.logger.log({ count: n }, 'Facturas marcadas como vencidas');
    }
    return n;
  }
}
