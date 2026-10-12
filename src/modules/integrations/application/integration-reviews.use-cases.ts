import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { PageRequest } from '@/shared/domain/pagination';
import { CollectionLedger, IntegrationRunRepository, ReviewRepository, ReviewStatus } from '../domain/integration.repository';
import { ReviewKind } from '../domain/reconciliation';

export type ReviewAction = 'RESOLVE' | 'IGNORE' | 'CLOSE_PROCESS';

@Injectable()
export class IntegrationQueriesUseCase {
  constructor(
    private readonly runs: IntegrationRunRepository,
    private readonly reviews: ReviewRepository,
  ) {}

  listRuns(req: PageRequest) {
    return this.runs.list(req);
  }

  async run(id: number) {
    const r = await this.runs.get(id);
    if (!r) throw new NotFoundError('Execução não encontrada');
    return r;
  }

  listReviews(f: { status?: ReviewStatus; kind?: ReviewKind }, req: PageRequest) {
    return this.reviews.search(f, req);
  }
}

/**
 * Fecha um caso da fila de revisão.
 *  - CLOSE_PROCESS: só para "processo pronto a fechar" — fecha-o agora (as regras são verificadas de novo);
 *  - RESOLVE: o gestor tratou o caso (ex.: registou o pagamento no acordo);
 *  - IGNORE: não há nada a fazer.
 */
@Injectable()
export class ResolveReviewUseCase {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly ledger: CollectionLedger,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(me: AuthenticatedUser, id: number, action: ReviewAction, note: string) {
    return this.uow.run(async () => {
      const item = await this.reviews.findForUpdate(id);
      if (!item) throw new NotFoundError('Caso não encontrado');
      if (item.status !== 'OPEN') throw new ConflictError('Este caso já foi tratado');
      let resolution = note.trim();
      if (action === 'CLOSE_PROCESS') {
        if (item.kind !== 'PROCESS_READY_TO_CLOSE' || !item.processId) throw new BusinessRuleError('Só os casos "processo pronto a fechar" podem fechar um processo');
        const reason = (item.details as { reason?: string })?.reason === 'CANCELLED_IN_ERP' ? 'CANCELLED_IN_ERP' : 'PAID_IN_ERP';
        if (!(await this.ledger.closeProcess(item.processId, reason))) {
          throw new BusinessRuleError('O processo já não pode ser fechado: tem facturas por liquidar, um acordo activo, ou já foi fechado');
        }
        resolution = resolution || 'Processo fechado';
      }
      const status = action === 'IGNORE' ? 'IGNORED' : 'RESOLVED';
      if (!(await this.reviews.resolve(id, item.version, status, resolution || (status === 'IGNORED' ? 'Ignorado' : 'Resolvido'), me.id))) {
        throw new ConflictError('Este caso foi alterado entretanto; recarregue');
      }
      await this.audit.record({ action: 'INTEGRATION_REVIEW_RESOLVED', entity: 'integration_review', entityId: id, payload: { kind: item.kind, action, note: resolution, processId: item.processId } });
      return { id, status };
    });
  }
}
