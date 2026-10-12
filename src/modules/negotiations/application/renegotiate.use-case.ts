import { Money } from '@/shared/domain/money';
import { Inject, Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { FinancialCalculator } from '../domain/financial-calculator';
import { NegotiationInput, NegotiationPolicy } from '../domain/negotiation';
import {
  assertTransition,
  computeRenegotiationBalance,
  NEGOTIATION_SETTINGS,
  NegotiationSettings,
  RenegotiationBalance,
  requiresApproval,
} from '../domain/negotiation-lifecycle';
import { Negotiation, NegotiationRepository } from '../domain/negotiation.repository';
import { ApprovalRequestNotifier } from './approval-request.notifier';
import { luandaToday } from './negotiation-lifecycle.use-cases';

export type RenegotiationInput = Omit<NegotiationInput, 'debtAmount' | 'processIds'>;

@Injectable()
export class RenegotiationBalanceUseCase {
  constructor(
    private readonly repo: NegotiationRepository,
    private readonly calc: FinancialCalculator,
    private readonly clock: Clock,
    @Inject(NEGOTIATION_SETTINGS) private readonly settings: NegotiationSettings,
    private readonly uow: UnitOfWork,
  ) {}

  /**
   * Saldo actual para renegociar (capital em aberto + multa + juros), com detalhe por prestação.
   * Leitura numa transacção: o findForUpdate usa lock de linha e o TypeORM exige transacção aberta
   * (sem ela dava 500 "An open transaction is required for pessimistic lock").
   */
  execute(id: number): Promise<RenegotiationBalance & { negotiationId: number; status: string }> {
    return this.uow.run(async () => {
      const neg = await this.repo.findForUpdate(id);
      if (!neg) throw new NotFoundError('Negociação não encontrada');
      assertTransition(neg.status, 'RENEGOTIATED');
      return { negotiationId: id, status: neg.status, ...(await this.compute(neg)) };
    });
  }

  async compute(neg: Negotiation): Promise<RenegotiationBalance> {
    const open = await this.repo.openInstallments(neg.id);
    // à vista: abate o que já foi pago (alocações confirmadas)
    const base = neg.isInstallment ? neg : { ...neg, finalAmount: Money.of(neg.finalAmount).minus((await this.repo.paymentSummary(neg.id)).allocated).toString() };
    return computeRenegotiationBalance(this.calc, base, open, luandaToday(this.clock), this.settings.lateMonthlyInterestPercent);
  }
}

/**
 * Renegociação atómica (uma transacção, Idempotency-Key no controller):
 *  1. bloqueia o acordo anterior (FOR UPDATE) — tem de estar ACTIVE ou BROKEN;
 *  2. calcula no servidor o saldo de abertura ("inclui tudo") — o cliente não o pode forjar;
 *  3. valida a nova proposta com as mesmas regras de uma negociação normal;
 *  4. anterior → RENEGOTIATED (prestações em aberto canceladas, processos libertados);
 *  5. novo acordo com previous_negotiation_id e os mesmos processos; aprovação só acima do limite.
 * Dois pedidos simultâneos: o segundo espera o lock e falha (já RENEGOTIATED); o índice único
 * em previous_negotiation_id é a última barreira.
 */
@Injectable()
export class RenegotiateUseCase {
  constructor(
    private readonly repo: NegotiationRepository,
    private readonly balance: RenegotiationBalanceUseCase,
    private readonly policy: NegotiationPolicy,
    private readonly approvalNotifier: ApprovalRequestNotifier,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    @Inject(NEGOTIATION_SETTINGS) private readonly settings: NegotiationSettings,
  ) {}

  execute(previousId: number, input: RenegotiationInput, userId: number) {
    return this.uow.run(async () => {
      const prev = await this.repo.findForUpdate(previousId);
      if (!prev) throw new NotFoundError('Negociação não encontrada');
      assertTransition(prev.status, 'RENEGOTIATED');
      const pays = await this.repo.paymentSummary(previousId);
      if (pays.pending > 0) {
        throw new BusinessRuleError(`Há ${pays.pending} pagamento(s) pendente(s) de confirmação neste acordo. Confirme ou anule antes de renegociar.`);
      }

      const bal = await this.balance.compute(prev);
      const processIds = await this.repo.processIdsOf(previousId);
      const full: NegotiationInput = { ...input, debtAmount: bal.total, processIds };
      this.policy.validate(full, luandaToday(this.clock)); // desconto/total validados sobre o NOVO saldo

      if (!(await this.repo.markRenegotiated(previousId, prev.version))) throw new ConflictError('O acordo foi alterado em simultâneo');
      const pending = requiresApproval(input.discountRate, this.settings);
      const neg = await this.repo.create(full, userId, { status: pending ? 'PENDING_APPROVAL' : 'ACTIVE', previousNegotiationId: previousId });
      if (pending) await this.approvalNotifier.notify(neg.id, userId, input.discountRate, previousId);

      await this.audit.record({
        action: 'NEGOTIATION_RENEGOTIATED',
        entity: 'negotiation',
        entityId: neg.id,
        payload: { previousId, previousStatus: prev.status, openingBalance: bal, newStatus: neg.status, finalAmount: neg.finalAmount },
      });
      return { id: neg.id, status: neg.status, openingBalance: bal };
    });
  }
}
