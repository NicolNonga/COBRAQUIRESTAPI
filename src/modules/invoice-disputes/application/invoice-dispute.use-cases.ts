import { Injectable } from '@nestjs/common';
import { InvoiceStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { Criteria, FilterOperator, Sort } from '@/shared/domain/criteria';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { DisputeField, DisputeOutcome, DisputePolicy, DisputeRepository, DisputeStatus } from '../domain/invoice-dispute';

export const INVOICE_DISPUTE_RESOLVE_PERMISSION = 'invoice_dispute_resolve_permission';

const luandaToday = (clock: Clock) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda' }).format(clock.now());

/**
 * Abre disputa sobre uma factura (esteja ou não num processo). Atómico:
 * factura bloqueada → validações → sai do processo → "Em disputa" → registo da disputa.
 * Factura num processo com acordo em vigor não pode ser disputada (mudaria a dívida acordada).
 */
@Injectable()
export class OpenDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly states: StateCatalog,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(me: AuthenticatedUser, invoiceId: number, reason: string): Promise<{ id: string }> {
    const disputeState = await this.states.invoiceStateId(InvoiceStateCode.IN_DISPUTE);
    return this.uow.run(async () => {
      const inv = await this.disputes.lockInvoice(invoiceId);
      if (!inv) throw new NotFoundError('Factura não encontrada');
      DisputePolicy.assertDisputable(inv.stateCode);
      if (inv.processHasActiveNegotiation) {
        throw new BusinessRuleError('A factura está num processo com negociação activa; cancele/renegocie antes de a disputar');
      }
      await this.disputes.detachAndMarkDisputed(inv.id, inv.processId, disputeState);
      const [id] = await this.disputes.insertOpen([{ invoiceId: inv.id, processId: inv.processId, reason: reason.trim(), originalAmount: inv.amount, openedById: me.id }]);
      await this.audit.record({ action: 'INVOICE_DISPUTE_OPENED', entity: 'invoice_dispute', entityId: id, payload: { invoiceId, processId: inv.processId, reason, previousState: inv.stateCode } });
      return { id };
    });
  }
}

export interface ResolveDisputeInput {
  outcome: DisputeOutcome;
  notes: string;
  adjustedAmount?: string;
}

/**
 * Resolve a disputa (permissão `invoice_dispute_resolve_permission`):
 *  UPHELD/ADJUSTED → factura volta a Vencida (ou Em curso se ainda não venceu); o job de geração
 *                    junta-a ao processo aberto do devedor (≤ 5 min);
 *  CANCELLED       → factura Cancelada (sai da dívida).
 * O valor original fica na disputa; nada é apagado.
 */
@Injectable()
export class ResolveDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly states: StateCatalog,
    private readonly notifications: NotificationPublisher,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(me: AuthenticatedUser, id: string, input: ResolveDisputeInput) {
    const ids = {
      OVERDUE: await this.states.invoiceStateId(InvoiceStateCode.OVERDUE),
      IN_PROGRESS: await this.states.invoiceStateId(InvoiceStateCode.IN_PROGRESS),
      CANCELLED: await this.states.invoiceStateId(InvoiceStateCode.CANCELLED),
    };
    return this.uow.run(async () => {
      const d = await this.disputes.findForUpdate(id); // ordem de locks: disputa → factura
      if (!d) throw new NotFoundError('Disputa não encontrada');
      if (d.status !== 'OPEN') throw new ConflictError('A disputa já foi resolvida');
      const inv = await this.disputes.lockInvoice(d.invoiceId);
      if (!inv) throw new NotFoundError('Factura não encontrada');
      if (inv.stateCode !== 'IN_DISPUTE') throw new ConflictError(`A factura não está em disputa (estado: ${inv.stateCode})`);

      const decision = DisputePolicy.resolve(input.outcome, d.originalAmount, input.adjustedAmount, inv.dueDate, luandaToday(this.clock));
      if (!(await this.disputes.markResolved(id, d.version, input.outcome, decision.newAmount, input.notes.trim(), me.id))) {
        throw new ConflictError('A disputa foi alterada em simultâneo');
      }
      await this.disputes.applyToInvoice(d.invoiceId, ids[decision.stateAfter], decision.newAmount);

      if (d.openedById && d.openedById !== me.id) {
        const what = { UPHELD: 'procedente para o credor — volta à cobrança', CANCELLED: 'anulada — saiu da dívida', ADJUSTED: `valor corrigido para ${decision.newAmount} — volta à cobrança` }[input.outcome];
        await this.notifications.publish({
          userId: d.openedById,
          type: 'invoice_dispute.resolved',
          title: 'Disputa resolvida',
          message: `A disputa da factura #${d.invoiceId} foi resolvida: ${what}.`,
          data: { disputeId: id, invoiceId: d.invoiceId, outcome: input.outcome },
          priority: 'medium',
          actionUrl: `/invoice-disputes/${id}`,
        });
      }
      await this.audit.record({
        action: 'INVOICE_DISPUTE_RESOLVED',
        entity: 'invoice_dispute',
        entityId: id,
        payload: { invoiceId: d.invoiceId, outcome: input.outcome, originalAmount: d.originalAmount, newAmount: decision.newAmount, invoiceState: decision.stateAfter, notes: input.notes },
      });
      return { invoiceId: d.invoiceId, outcome: input.outcome, invoiceState: decision.stateAfter, amount: decision.newAmount ?? d.originalAmount };
    });
  }
}

@Injectable()
export class DisputeQueriesUseCase {
  constructor(private readonly disputes: DisputeRepository) {}

  list(f: {
    page: number;
    perPage: number;
    search?: string;
    sort?: Sort<DisputeField>[];
    statuses?: DisputeStatus[];
    outcome?: DisputeOutcome;
    invoiceId?: number;
    debtorId?: number;
    organizationId?: number;
    openedFrom?: string;
    openedTo?: string;
  }) {
    return this.disputes.search(
      Criteria.for<DisputeField>()
        .add('status', f.statuses, FilterOperator.IN)
        .add('outcome', f.outcome)
        .add('invoiceId', f.invoiceId)
        .add('debtorId', f.debtorId)
        .add('organizationId', f.organizationId)
        .add('openedAt', f.openedFrom, FilterOperator.GREATER_OR_EQUAL)
        .add('openedAt', f.openedTo, FilterOperator.LESS_OR_EQUAL)
        .anyOf(['invoiceReference', 'debtorName'], f.search)
        .orderBy(f.sort, { field: 'openedAt', direction: 'ASC' })
        .paginate(f.page, f.perPage)
        .build(),
    );
  }

  async byId(id: string) {
    const d = await this.disputes.findDetailed(id);
    if (!d) throw new NotFoundError('Disputa não encontrada');
    return d;
  }
}
