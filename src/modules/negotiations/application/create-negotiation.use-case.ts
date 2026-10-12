import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProcessLookup } from '@/modules/processes/domain/process.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { NegotiationInput, NegotiationPolicy } from '../domain/negotiation';
import { NegotiationRepository } from '../domain/negotiation.repository';
import { NEGOTIATION_SETTINGS, NegotiationSettings, requiresApproval } from '../domain/negotiation-lifecycle';
import { ApprovalRequestNotifier } from './approval-request.notifier';

@Injectable()
export class CreateNegotiationUseCase {
  private readonly logger = new Logger(CreateNegotiationUseCase.name);

  constructor(
    private readonly negotiations: NegotiationRepository,
    private readonly processes: ProcessLookup,
    private readonly policy: NegotiationPolicy,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    private readonly approvalNotifier: ApprovalRequestNotifier,
    @Inject(NEGOTIATION_SETTINGS) private readonly settings: NegotiationSettings,
  ) {}

  /**
   * Fluxo atómico (uma transacção):
   *  1. regras puras (datas, valores, prestações) — falha cedo, sem tocar na BD;
   *  2. SELECT … FOR UPDATE dos processos (ordenados → sem deadlock);
   *  3. processos abertos e não presos noutra negociação activa;
   *  4. a dívida declarada TEM de bater com a soma real das facturas (o servidor é a fonte de verdade);
   *  5. grava cabeçalho + processos + prestações e auditoria.
   * Duas negociações concorrentes sobre o mesmo processo: a segunda espera o lock
   * e depois falha no passo 3 (e, em último caso, no índice único parcial).
   */
  async execute(input: NegotiationInput, userId: number) {
    const today = this.clock.now().toISOString().slice(0, 10);
    this.policy.validate(input, today);
    const ids = [...input.processIds].sort((a, b) => a - b);

    return this.uow.run(async () => {
      const locked = await this.processes.lockForUpdate(ids);
      const missing = ids.filter((id) => !locked.some((l) => l.id === id));
      if (missing.length) throw new NotFoundError('Processos não encontrados', { processIds: missing });
      const closed = locked.filter((l) => !l.isOpen).map((l) => l.id);
      if (closed.length) throw new BusinessRuleError('Não é possível negociar processos fechados', { processIds: closed });
      if (new Set(locked.map((l) => l.debtorId)).size > 1) throw new BusinessRuleError('Todos os processos devem pertencer ao mesmo devedor');

      const busy = await this.negotiations.processesInActiveNegotiation(ids);
      if (busy.length) {
        const codes = busy.map((id) => `PRC-${String(id).padStart(5, '0')}`).join(', ');
        throw new ConflictError(`Já existe um acordo activo (ou à espera de aprovação) para ${busy.length === 1 ? 'o processo' : 'os processos'} ${codes}. Cancele ou quebre esse acordo, ou retire ${busy.length === 1 ? 'esse processo' : 'esses processos'} da selecção.`, { processIds: busy });
      }

      const outstanding = Money.of(await this.processes.outstandingAmount(ids));
      if (!outstanding.equals(input.debtAmount)) {
        throw new BusinessRuleError(`O valor da dívida indicado (${Money.of(input.debtAmount)}) difere do valor em dívida dos processos (${outstanding})`);
      }

      // "Aprovação: apenas quando acima do limite" — abaixo do limite entra logo em vigor
      const pending = requiresApproval(input.discountRate, this.settings);
      const neg = await this.negotiations.create({ ...input, processIds: ids }, userId, { status: pending ? 'PENDING_APPROVAL' : 'ACTIVE' });
      if (pending) await this.approvalNotifier.notify(neg.id, userId, input.discountRate);
      await this.audit.record({
        action: 'NEGOTIATION_CREATED',
        entity: 'negotiation',
        entityId: neg.id,
        payload: {
          processIds: ids,
          debtAmount: neg.debtAmount,
          discountAmount: neg.discountAmount,
          totalAmount: neg.totalAmount,
          finalAmount: neg.finalAmount,
          installments: input.installments?.length ?? 0,
          status: neg.status,
        },
      });
      this.logger.log({ negotiationId: neg.id, totalAmount: neg.totalAmount }, 'Negociação criada');
      return neg;
    });
  }
}
