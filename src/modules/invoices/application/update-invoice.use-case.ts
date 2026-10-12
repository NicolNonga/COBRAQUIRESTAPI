import { Injectable } from '@nestjs/common';
import { InvoiceStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { auditDiff } from '@/shared/application/audit-diff';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, NotFoundError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { addDays } from '../domain/invoice';
import { InvoiceChanges, InvoiceRepository } from '../domain/invoice.repository';

export interface UpdateInvoiceInput {
  refencence_number: string;
  amount: string;
  issue_date: string;
  time_limit: number;
  debtor_id: number;
  currency_id: number;
}

/** Estados em que a factura já não se altera (o dinheiro já se moveu, foi anulada ou está contestada). */
const LOCKED_STATES = new Set<string>([InvoiceStateCode.PAID, InvoiceStateCode.PARTIALLY_PAID, InvoiceStateCode.CANCELLED, InvoiceStateCode.IN_DISPUTE]);
const OPEN_STATES = new Set<string>([InvoiceStateCode.PENDING, InvoiceStateCode.IN_PROGRESS, InvoiceStateCode.OVERDUE]);

/**
 * Edição de factura — todos os campos (número, valor, emissão, prazo, moeda, devedor); o PDF anexa-se à parte.
 *  - paga / parcialmente paga / cancelada / em disputa → bloqueada;
 *  - num processo com negociação activa → valor, datas, moeda e devedor bloqueados
 *    (a dívida acordada foi validada contra o total das facturas);
 *  - mudou de devedor estando num processo → sai desse processo (o job coloca-a no processo do novo devedor);
 *  - vencimento recalculado (emissão + prazo) e estado ajustado: vencida ↔ em curso.
 */
@Injectable()
export class UpdateInvoiceUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly states: StateCatalog,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(id: number, input: UpdateInvoiceInput): Promise<void> {
    return this.uow.run(async () => {
      const cur = await this.invoices.findForUpdate(id);
      if (!cur) throw new NotFoundError('Factura não encontrada');
      if (LOCKED_STATES.has(cur.stateCode)) throw new BusinessRuleError('Esta factura já não pode ser alterada (está paga, cancelada ou em disputa)');

      const ref = input.refencence_number.trim();
      if (!ref) throw new BusinessRuleError('Número da factura é obrigatório');
      const amount = Money.of(input.amount);
      if (!amount.isPositive()) throw new BusinessRuleError('O valor da factura deve ser maior que zero');
      const dueDate = addDays(input.issue_date, input.time_limit);

      const debtorChanged = cur.debtorId !== input.debtor_id;
      const financialChanged =
        debtorChanged || !Money.of(cur.amount).equals(amount) || cur.issueDate !== input.issue_date ||
        cur.timeLimitDays !== input.time_limit || cur.currencyId !== input.currency_id;

      const proc = cur.inProcess ? await this.invoices.processOf(id) : null;
      if (financialChanged && proc?.activeNegotiationId) {
        const neg = `NEG-${String(proc.activeNegotiationId).padStart(5, '0')}`;
        throw new BusinessRuleError(
          `Esta factura faz parte da negociação ${neg}, que está activa: só pode alterar o número. Para mudar valor, datas, moeda ou devedor, cancele ou renegocie primeiro o acordo.`,
        );
      }

      const changes: InvoiceChanges = {
        referenceNumber: ref,
        amount: amount.toString(),
        issueDate: input.issue_date,
        timeLimitDays: input.time_limit,
        dueDate,
        debtorId: input.debtor_id,
        currencyId: input.currency_id,
      };
      // estado acompanha o novo vencimento (só entre estados abertos)
      if (OPEN_STATES.has(cur.stateCode)) {
        const today = this.clock.now().toISOString().slice(0, 10);
        const target = dueDate < today ? InvoiceStateCode.OVERDUE : InvoiceStateCode.IN_PROGRESS;
        if (target !== cur.stateCode) changes.invoiceStateId = await this.states.invoiceStateId(target);
      }

      const before = await this.audit.snapshot('invoices', { id });
      await this.invoices.update(id, changes);
      if (debtorChanged && proc) await this.invoices.detachFromProcess(id);
      const after = await this.audit.snapshot('invoices', { id });
      await this.audit.record({
        action: 'INVOICE_UPDATED',
        entity: 'invoice',
        entityId: id,
        payload: { ...auditDiff(before, after), ...(debtorChanged && proc ? { removedFromProcessId: proc.processId } : {}) },
      });
    });
  }
}
