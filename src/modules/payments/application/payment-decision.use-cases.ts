import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStateCode, ProcessStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { CreditorLedger } from '@/modules/creditor-accounts/domain/creditor-ledger.port';
import { luandaToday } from '@/modules/negotiations/application/negotiation-lifecycle.use-cases';
import { NewNotification } from '@/modules/notifications/domain/notification.repository';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { PaymentPolicy, PaymentStatus } from '../domain/payment';
import { DebtorCreditRepository, Payment, PaymentRepository, PaymentSettlementRepository } from '../domain/payment.repository';
import { PaymentAuthority } from './payment-authority';

/**
 * Carrega o pagamento respeitando a ordem de locks do módulo: acordo → pagamento → prestações.
 * (O registo também bloqueia primeiro o acordo; o job de quebra usa SKIP LOCKED.) Sem ciclos → sem deadlocks.
 */
const lockPayment = async (repo: PaymentRepository, id: string, expected: PaymentStatus) => {
  const head = await repo.findById(id);
  if (!head) throw new NotFoundError('Pagamento não encontrado');
  const negotiation = await repo.lockNegotiation(head.negotiationId);
  const payment = await repo.findForUpdate(id);
  if (!negotiation || !payment) throw new NotFoundError('Pagamento não encontrado');
  if (payment.status !== expected) throw new ConflictError(`O pagamento está ${payment.status}`);
  return { payment, negotiation };
};

export interface ConfirmationResult {
  paymentId: string;
  allocations: Array<{ installmentId: number | null; amount: string; coversBucket: boolean }>;
  credit: string;
  commission: string;
  installmentsPaid: number;
  negotiationCompleted: boolean;
  processesClosed: number;
  invoicesPaid: number;
}

/**
 * Confirmação (após validar o comprovativo), tudo numa transacção:
 *  1. aloca o valor: prestação indicada → prestações seguintes por vencimento → excedente = crédito do devedor;
 *  2. prestações cobertas → PAID;
 *  3. comissão do credor (snapshot da taxa) e lançamentos na conta-corrente (A ou B);
 *  4. acordo totalmente pago → COMPLETED → processos Finalizados → facturas Liquidadas;
 *  5. notificações via outbox (só saem depois do commit).
 */
@Injectable()
export class ConfirmPaymentUseCase {
  private readonly logger = new Logger(ConfirmPaymentUseCase.name);

  constructor(
    private readonly payments: PaymentRepository,
    private readonly settlement: PaymentSettlementRepository,
    private readonly credit: DebtorCreditRepository,
    private readonly ledger: CreditorLedger,
    private readonly states: StateCatalog,
    private readonly authority: PaymentAuthority,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(me: AuthenticatedUser, id: string): Promise<ConfirmationResult> {
    const [finished, paidInvoice] = await Promise.all([this.states.processStateId(ProcessStateCode.FINISHED), this.states.invoiceStateId(InvoiceStateCode.PAID)]);
    return this.uow.run(async () => {
      const { payment: p, negotiation } = await lockPayment(this.payments, id, 'PENDING');
      await this.authority.assertCanDecide(me, p.registeredById, 'confirmar');

      const buckets = await this.settlement.openBuckets(negotiation.id, negotiation.isInstallment, p.installmentId);
      const { allocations, credit } = PaymentPolicy.allocate(p.amountBase, buckets);
      const rate = await this.ledger.commissionRateOf(p.organizationId);
      const commission = PaymentPolicy.commission(p.amountBase, rate).toString();

      if (!(await this.payments.markConfirmed(id, p.version, me.id, { commissionRate: rate, commissionAmount: commission, creditAmount: credit }))) {
        throw new ConflictError('O pagamento foi alterado em simultâneo');
      }
      await this.settlement.saveAllocations(id, negotiation.id, p.paidOn, allocations);
      const installmentsPaid = await this.settlement.markInstallmentsPaid(
        allocations.filter((a) => a.coversBucket && a.installmentId !== null).map((a) => a.installmentId as number),
      );
      if (Money.of(credit).isPositive()) {
        await this.credit.lock(p.debtorId);
        await this.credit.add({
          debtorId: p.debtorId,
          organizationId: p.organizationId,
          negotiationId: negotiation.id,
          paymentId: id,
          kind: 'OVERPAYMENT',
          amount: credit,
          description: `Excedente do pagamento #${id} (acordo #${negotiation.id})`,
          createdById: me.id,
        });
      }
      await this.ledger.record(
        PaymentPolicy.creditorEntries(p.receiver, p.amountBase, commission, id).map((e) => ({ ...e, organizationId: p.organizationId, paymentId: id })),
      );
      const done = await this.settlement.completeIfSettled(negotiation.id, finished, paidInvoice);

      await this.notifications.publish(this.notificationsFor(p, credit, done.completedNegotiationId ? done.negotiationCreatedBy : null, !!done.completedNegotiationId));
      await this.audit.record({
        action: 'PAYMENT_CONFIRMED',
        entity: 'payment',
        entityId: id,
        payload: { negotiationId: negotiation.id, amountBase: p.amountBase, allocations, credit, commissionRate: rate, commission, receiver: p.receiver, completion: done },
      });
      if (done.completedNegotiationId) this.logger.log({ negotiationId: negotiation.id, paymentId: id }, 'Acordo liquidado');
      return {
        paymentId: id,
        allocations,
        credit,
        commission,
        installmentsPaid,
        negotiationCompleted: !!done.completedNegotiationId,
        processesClosed: done.processesClosed,
        invoicesPaid: done.invoicesPaid,
      };
    });
  }

  private notificationsFor(p: Payment, credit: string, creatorId: number | null, completed: boolean): NewNotification[] {
    const out: NewNotification[] = [
      {
        userId: p.registeredById,
        type: 'payment.confirmed',
        title: 'Pagamento confirmado',
        message: `O pagamento #${p.id} (${p.amountBase}) foi confirmado.${Money.of(credit).isPositive() ? ` Excedente de ${credit} ficou como crédito do devedor.` : ''}`,
        data: { paymentId: p.id, negotiationId: p.negotiationId, credit },
        priority: 'medium',
        actionUrl: `/payments/${p.id}`,
      },
    ];
    if (completed) {
      for (const userId of new Set([p.registeredById, creatorId].filter((x): x is number => !!x))) {
        out.push({
          userId,
          type: 'negotiation.completed',
          title: 'Acordo liquidado',
          message: `A negociação #${p.negotiationId} foi totalmente paga. Processos fechados e facturas liquidadas.`,
          data: { negotiationId: p.negotiationId },
          priority: 'medium',
          actionUrl: `/negotiations/${p.negotiationId}`,
        });
      }
    }
    return out;
  }
}

/** Anular um pagamento PENDENTE registado por engano: nada se apaga, fica CANCELLED com motivo, quem e quando. */
@Injectable()
export class CancelPaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly authority: PaymentAuthority,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(me: AuthenticatedUser, id: string, reason: string): Promise<void> {
    return this.uow.run(async () => {
      const { payment: p } = await lockPayment(this.payments, id, 'PENDING');
      await this.authority.assertCanDecide(me, p.registeredById, 'anular');
      if (!(await this.payments.markCancelled(id, p.version, me.id, reason))) throw new ConflictError('O pagamento foi alterado em simultâneo');
      await this.notifications.publish({
        userId: p.registeredById,
        type: 'payment.cancelled',
        title: 'Pagamento anulado',
        message: `O pagamento #${id} foi anulado: ${reason}`,
        data: { paymentId: id, negotiationId: p.negotiationId, reason },
        priority: 'high',
        actionUrl: `/payments/${id}`,
      });
      await this.audit.record({ action: 'PAYMENT_CANCELLED', entity: 'payment', entityId: id, payload: { reason, amountBase: p.amountBase } });
    });
  }
}

/**
 * Estorno de um pagamento CONFIRMADO (ex.: transferência devolvida, comprovativo falso).
 * Nada se apaga: o pagamento fica REVERSED; as alocações ficam marcadas como estornadas; prestações que
 * deixam de estar cobertas reabrem; um acordo COMPLETED volta a ACTIVE (processos e facturas reabertos);
 * crédito gerado e lançamentos do credor são anulados com lançamentos inversos.
 */
@Injectable()
export class ReversePaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly settlement: PaymentSettlementRepository,
    private readonly credit: DebtorCreditRepository,
    private readonly ledger: CreditorLedger,
    private readonly states: StateCatalog,
    private readonly authority: PaymentAuthority,
    private readonly notifications: NotificationPublisher,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(me: AuthenticatedUser, id: string, reason: string): Promise<{ installmentsReopened: number; negotiationReopened: boolean }> {
    const [inProgressProcess, inProgressInvoice] = await Promise.all([
      this.states.processStateId(ProcessStateCode.IN_PROGRESS),
      this.states.invoiceStateId(InvoiceStateCode.IN_PROGRESS),
    ]);
    return this.uow.run(async () => {
      const { payment: p, negotiation } = await lockPayment(this.payments, id, 'CONFIRMED');
      if (!['ACTIVE', 'COMPLETED', 'BROKEN'].includes(negotiation.status)) {
        throw new BusinessRuleError(`Não é possível estornar: o acordo está ${negotiation.status} (o saldo já foi usado noutro acordo)`);
      }
      await this.authority.assertCanDecide(me, p.registeredById, 'estornar');

      const credit = p.creditAmount ?? '0';
      if (Money.of(credit).isPositive()) {
        await this.credit.lock(p.debtorId);
        const balance = await this.credit.balanceOf(p.debtorId);
        if (Money.of(balance).lt(credit)) {
          throw new BusinessRuleError(`Não é possível estornar: o crédito gerado (${credit}) já foi utilizado (saldo actual ${balance})`);
        }
      }

      if (!(await this.payments.markReversed(id, p.version, me.id, reason))) throw new ConflictError('O pagamento foi alterado em simultâneo');
      const touched = await this.settlement.reverseAllocations(id);
      const installmentsReopened = await this.settlement.reopenInstallments(touched, luandaToday(this.clock));
      const negotiationReopened =
        negotiation.status === 'COMPLETED' ? await this.settlement.reopenNegotiation(negotiation.id, inProgressProcess, inProgressInvoice) : false;
      if (Money.of(credit).isPositive()) {
        await this.credit.add({
          debtorId: p.debtorId,
          organizationId: p.organizationId,
          negotiationId: negotiation.id,
          paymentId: id,
          kind: 'REVERSAL',
          amount: Money.zero().minus(credit).toString(),
          description: `Estorno do pagamento #${id}: ${reason}`,
          createdById: me.id,
        });
      }
      await this.ledger.reversePayment(id, `Estorno do pagamento #${id}: ${reason}`);

      await this.notifications.publish({
        userId: p.registeredById,
        type: 'payment.reversed',
        title: 'Pagamento estornado',
        message: `O pagamento #${id} (${p.amountBase}) foi estornado: ${reason}${negotiationReopened ? `. O acordo #${negotiation.id} voltou a estar em vigor.` : ''}`,
        data: { paymentId: id, negotiationId: negotiation.id, reason },
        priority: 'high',
        actionUrl: `/payments/${id}`,
      });
      await this.audit.record({
        action: 'PAYMENT_REVERSED',
        entity: 'payment',
        entityId: id,
        payload: { reason, amountBase: p.amountBase, credit, installmentsReopened, negotiationReopened, negotiationId: negotiation.id },
      });
      return { installmentsReopened, negotiationReopened };
    });
  }
}
