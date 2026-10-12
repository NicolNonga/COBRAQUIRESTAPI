import { Inject, Injectable } from '@nestjs/common';
import { luandaToday } from '@/modules/negotiations/application/negotiation-lifecycle.use-cases';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { FileStorage, UploadedBinary } from '@/shared/application/file-storage.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/shared/domain/errors';
import { PaymentPolicy, PaymentReceiver } from '../domain/payment';
import { CurrencyAdminRepository, PaymentMethodRepository, PaymentRepository } from '../domain/payment.repository';
import { PAYMENT_SETTINGS, PaymentSettings } from './payment-settings';

export interface RegisterPaymentInput {
  negotiationId: number;
  installmentId?: number | null;
  receiver: PaymentReceiver;
  amount: string;
  currencyId: number;
  exchangeRate?: string;
  paymentMethodId: number;
  paidOn: string;
  reference?: string | null;
  notes?: string | null;
  proof: UploadedBinary;
}

/**
 * O agente regista um pagamento com o comprovativo. Fica PENDING até um gestor/financeiro
 * validar o comprovativo e confirmar.
 *
 *  - quem recebeu: CREDITOR (opção A) ou AGENCY (opção B);
 *  - parcial é aceite; valor acima do que falta também — na confirmação o excedente abate
 *    as prestações seguintes e o resto fica como crédito do devedor;
 *  - concorrência: o acordo (e a prestação) ficam bloqueados FOR UPDATE durante o registo;
 *  - idempotência: Idempotency-Key no controller + índice único (meio, referência) na BD.
 */
@Injectable()
export class RegisterPaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly methods: PaymentMethodRepository,
    private readonly currencies: CurrencyAdminRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationPublisher,
    private readonly storage: FileStorage,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    @Inject(PAYMENT_SETTINGS) private readonly settings: PaymentSettings,
  ) {}

  async execute(input: RegisterPaymentInput, userId: number): Promise<{ id: string; amountBase: string }> {
    // validações sem estado ANTES de gravar o comprovativo
    PaymentPolicy.assertPaidOn(input.paidOn, luandaToday(this.clock));
    const [method, currency] = await Promise.all([this.methods.findActive(input.paymentMethodId), this.currencies.findActive(input.currencyId)]);
    if (!method) throw new ValidationError('Meio de pagamento inexistente ou inactivo');
    if (!currency) throw new ValidationError('Moeda inexistente ou inactiva');
    const reference = input.reference?.trim() || null;
    if (method.requiresReference && !reference) throw new ValidationError(`O meio "${method.name}" exige a referência do comprovativo`);
    const exchangeRate = PaymentPolicy.resolveExchangeRate(currency.code, this.settings.baseCurrencyCode, input.exchangeRate);
    const amountBase = PaymentPolicy.amountBase(input.amount, exchangeRate).toString();

    const proofPath = await this.storage.save(input.proof, 'payments');
    try {
      return await this.uow.run(async () => {
        const target = await this.payments.lockTarget(input.negotiationId, input.installmentId ?? null);
        if (!target) throw new NotFoundError('Negociação ou prestação não encontrada');
        if (target.status !== 'ACTIVE') {
          throw new BusinessRuleError(`Só se registam pagamentos em acordos em vigor (estado actual: ${target.status})`);
        }
        if (!target.isInstallment && target.installmentId) throw new ValidationError('Acordo à vista: não indique prestação');
        if (target.installmentId && !['PENDING', 'OVERDUE'].includes(target.installmentStatus ?? '')) {
          throw new BusinessRuleError(`A prestação está ${target.installmentStatus}; indique outra prestação ou nenhuma`);
        }

        const id = await this.payments.create({
          negotiationId: target.id,
          installmentId: target.installmentId,
          debtorId: target.debtorId,
          organizationId: target.organizationId,
          receiver: input.receiver,
          amount: input.amount,
          currencyId: currency.id,
          exchangeRate,
          amountBase,
          paymentMethodId: method.id,
          paidOn: input.paidOn,
          reference,
          proofPath,
          notes: input.notes?.trim() || null,
          registeredById: userId,
        });

        const managerId = await this.users.managerOf(userId);
        if (managerId && managerId !== userId) {
          await this.notifications.publish({
            userId: managerId,
            type: 'payment.confirmation_requested',
            title: 'Pagamento para confirmar',
            message: `Pagamento de ${input.amount} ${currency.code} (${method.name}) na negociação #${target.id} aguarda validação do comprovativo.`,
            data: { paymentId: id, negotiationId: target.id, installmentId: target.installmentId },
            priority: 'high',
            actionUrl: `/payments/${id}`,
          });
        }
        await this.audit.record({
          action: 'PAYMENT_REGISTERED',
          entity: 'payment',
          entityId: id,
          payload: {
            negotiationId: target.id,
            installmentId: target.installmentId,
            receiver: input.receiver,
            amount: input.amount,
            currency: currency.code,
            exchangeRate,
            amountBase,
            method: method.name,
            reference,
            paidOn: input.paidOn,
          },
        });
        return { id, amountBase };
      });
    } catch (e) {
      await this.storage.remove(proofPath).catch(() => undefined); // sem comprovativos órfãos
      throw e;
    }
  }
}
