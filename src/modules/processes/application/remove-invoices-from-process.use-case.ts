import { Injectable } from '@nestjs/common';
import { InvoiceStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, NotFoundError } from '@/shared/domain/errors';
import { DisputeRegistry } from '@/modules/invoice-disputes/domain/invoice-dispute';
import { ProcessCommandRepository } from '../domain/process.repository';

/** Retira facturas de um processo e coloca-as "Em disputa" (com registo da disputa) — atómico (tudo ou nada). */
@Injectable()
export class RemoveInvoicesFromProcessUseCase {
  constructor(
    private readonly processes: ProcessCommandRepository,
    private readonly states: StateCatalog,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    private readonly disputes: DisputeRegistry,
  ) {}

  async execute(processId: number, invoiceIds: number[], reason?: string, userId?: number): Promise<number> {
    const ids = [...new Set(invoiceIds)];
    const dispute = await this.states.invoiceStateId(InvoiceStateCode.IN_DISPUTE);
    return this.uow.run(async () => {
      if (!(await this.processes.findOpen(processId))) throw new NotFoundError('Processo não encontrado ou fechado');
      // alterar as facturas de um processo em negociação activa mudaria a dívida acordada
      if (await this.processes.hasActiveNegotiation(processId)) {
        throw new BusinessRuleError('O processo tem uma negociação activa; cancele-a antes de retirar facturas');
      }
      const removed = await this.processes.detachInvoicesToDispute(processId, ids, dispute);
      const notInProcess = ids.filter((id) => !removed.includes(id));
      if (notInProcess.length) {
        // lançar erro → rollback de TODAS as remoções deste pedido
        throw new BusinessRuleError('Algumas facturas não pertencem a este processo', { invoiceIds: notInProcess });
      }
      await this.disputes.recordOpened(
        removed.map((invoiceId) => ({ invoiceId, processId })),
        reason?.trim() || 'Retirada do processo (sem motivo indicado)',
        userId ?? null,
      );
      await this.audit.record({ action: 'INVOICES_REMOVED_FROM_PROCESS', entity: 'process', entityId: processId, payload: { invoiceIds: ids, reason } });
      return removed.length;
    });
  }
}
