import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { NegotiationRepository } from '../domain/negotiation.repository';
import { assertTransition } from '../domain/negotiation-lifecycle';

/** Cancela a negociação e liberta os processos para nova negociação. */
@Injectable()
export class CancelNegotiationUseCase {
  constructor(private readonly negotiations: NegotiationRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(id: number, reason: string) {
    return this.uow.run(async () => {
      const neg = await this.negotiations.findForUpdate(id); // FOR UPDATE
      if (!neg) throw new NotFoundError('Negociação não encontrada');
      assertTransition(neg.status, 'CANCELLED');
      const pays = await this.negotiations.paymentSummary(id);
      if (pays.pending > 0 || pays.confirmed > 0) {
        throw new BusinessRuleError('O acordo tem pagamentos registados: não pode ser cancelado. Use quebra/renegociação ou estorne os pagamentos.');
      }
      if (!(await this.negotiations.cancel(id, neg.version))) throw new ConflictError('A negociação foi alterada em simultâneo; tente novamente');
      await this.audit.record({ action: 'NEGOTIATION_CANCELLED', entity: 'negotiation', entityId: id, payload: { reason } });
    });
  }
}
