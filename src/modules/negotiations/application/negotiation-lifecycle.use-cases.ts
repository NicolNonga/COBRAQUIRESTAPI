import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/domain/errors';
import { assertTransition, NEGOTIATION_SETTINGS, NegotiationSettings } from '../domain/negotiation-lifecycle';
import { Negotiation, NegotiationRepository } from '../domain/negotiation.repository';

export const luandaToday = (clock: Clock) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda' }).format(clock.now());

const load = async (repo: NegotiationRepository, id: number): Promise<Negotiation> => {
  const n = await repo.findForUpdate(id); // FOR UPDATE: serializa decisões concorrentes sobre o mesmo acordo
  if (!n) throw new NotFoundError('Negociação não encontrada');
  return n;
};

/**
 * Quem pode aprovar: o gestor de quem criou, ou quem tem a permissão de aprovação.
 * Nunca quem criou (quatro olhos — também garantido por CHECK na BD).
 */
@Injectable()
export class ApprovalGuard {
  constructor(private readonly users: UserRepository) {}

  async assertCanDecide(me: AuthenticatedUser, neg: Negotiation): Promise<void> {
    if (neg.createdById === me.id) throw new ForbiddenError('Quem cria a negociação não a pode aprovar (quatro olhos)');
    if (me.permissions.includes('negotiation_approve_permission')) return;
    if (me.isManager && neg.createdById && (await this.users.managerOf(neg.createdById)) === me.id) return;
    throw new ForbiddenError('Sem autorização para aprovar esta negociação');
  }
}

@Injectable()
export class ApproveNegotiationUseCase {
  constructor(
    private readonly repo: NegotiationRepository,
    private readonly guard: ApprovalGuard,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(me: AuthenticatedUser, id: number) {
    return this.uow.run(async () => {
      const neg = await load(this.repo, id);
      assertTransition(neg.status, 'ACTIVE');
      await this.guard.assertCanDecide(me, neg);
      if (!(await this.repo.approve(id, neg.version, me.id))) throw new ConflictError('A negociação foi alterada em simultâneo');
      if (neg.createdById) {
        await this.notifications.publish({ userId: neg.createdById, type: 'negotiation.approved', title: 'Negociação aprovada', message: `A negociação #${id} foi aprovada e está em vigor.`, data: { negotiationId: id }, priority: 'medium' });
      }
      await this.audit.record({ action: 'NEGOTIATION_APPROVED', entity: 'negotiation', entityId: id });
    });
  }
}

@Injectable()
export class RejectNegotiationUseCase {
  constructor(
    private readonly repo: NegotiationRepository,
    private readonly guard: ApprovalGuard,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(me: AuthenticatedUser, id: number, reason: string) {
    return this.uow.run(async () => {
      const neg = await load(this.repo, id);
      assertTransition(neg.status, 'REJECTED');
      await this.guard.assertCanDecide(me, neg);
      if (!(await this.repo.reject(id, neg.version, me.id, reason))) throw new ConflictError('A negociação foi alterada em simultâneo');
      if (neg.createdById) {
        await this.notifications.publish({ userId: neg.createdById, type: 'negotiation.rejected', title: 'Negociação rejeitada', message: `A negociação #${id} foi rejeitada: ${reason}`, data: { negotiationId: id, reason }, priority: 'high' });
      }
      await this.audit.record({ action: 'NEGOTIATION_REJECTED', entity: 'negotiation', entityId: id, payload: { reason } });
    });
  }
}

@Injectable()
export class BreakNegotiationUseCase {
  constructor(private readonly repo: NegotiationRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  /** Quebra manual (ex.: devedor declarou que não vai pagar). Liberta os processos para renegociação. */
  execute(me: AuthenticatedUser, id: number, reason: string) {
    return this.uow.run(async () => {
      const neg = await load(this.repo, id);
      assertTransition(neg.status, 'BROKEN');
      if (!(await this.repo.break(id, neg.version, me.id, reason))) throw new ConflictError('A negociação foi alterada em simultâneo');
      await this.audit.record({ action: 'NEGOTIATION_BROKEN', entity: 'negotiation', entityId: id, payload: { reason, manual: true } });
    });
  }
}

@Injectable()
export class AutoBreakNegotiationsUseCase {
  private readonly logger = new Logger(AutoBreakNegotiationsUseCase.name);

  constructor(
    private readonly repo: NegotiationRepository,
    private readonly notifications: NotificationPublisher,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    @Inject(NEGOTIATION_SETTINGS) private readonly settings: NegotiationSettings,
  ) {}

  /** "Quebra a partir do primeiro dia" — job diário. Desligado até existir registo de pagamentos. */
  execute(): Promise<number> {
    if (!this.settings.autoBreakEnabled) return Promise.resolve(0);
    return this.uow.run(async () => {
      const broken = await this.repo.autoBreakOverdue(luandaToday(this.clock));
      if (!broken.length) return 0;
      await this.notifications.publish(
        broken
          .filter((b) => b.createdById)
          .map((b) => ({
            userId: b.createdById!,
            type: 'negotiation.broken',
            title: 'Acordo quebrado',
            message: `A negociação #${b.negotiationId} foi quebrada por prestação em atraso. Pode renegociar.`,
            data: { negotiationId: b.negotiationId },
            priority: 'high' as const,
            actionUrl: `/negotiations/${b.negotiationId}`,
          })),
      );
      await this.audit.record({ action: 'NEGOTIATIONS_AUTO_BROKEN', entity: 'negotiation', payload: { ids: broken.map((b) => b.negotiationId) } });
      this.logger.log({ count: broken.length }, 'Acordos quebrados automaticamente');
      return broken.length;
    });
  }
}
