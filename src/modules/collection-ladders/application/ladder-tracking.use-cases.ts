import { Injectable, Logger } from '@nestjs/common';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { NewNotification } from '@/modules/notifications/domain/notification.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { Clock } from '@/shared/application/clock.port';
import { resolveTeamScope } from '@/shared/application/team-scope';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ValidationError } from '@/shared/domain/errors';
import { complianceRate, LadderTaskStatus } from '../domain/ladder';
import { LadderTracking, OverdueLadderTask } from '../domain/ladder-tracking';
import { luandaToday } from './luanda-date';

/** quem pode ver as tarefas/cumprimento de todos (sem ela: agente → as suas; gestor → a equipa) */
export const LADDER_VIEW_ALL_PERMISSION = 'dashboard_view_all_permission';

/**
 * Job de acompanhamento (frequente, ex.: a cada 15 min), numa transacção:
 *  1. processos fechados → VOID;  2. contactos registados → FULFILLED;  3. prazos ultrapassados → OVERDUE
 *  e escala (gestor + agente) via outbox. A ordem garante que um contacto feito a tempo nunca é escalado.
 */
@Injectable()
export class TrackLadderTasksUseCase {
  private readonly logger = new Logger(TrackLadderTasksUseCase.name);

  constructor(
    private readonly tracking: LadderTracking,
    private readonly notifications: NotificationPublisher,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(): Promise<{ voided: number; fulfilled: number; overdue: number }> {
    const today = luandaToday(this.clock.now());
    return this.uow.run(async () => {
      const voided = await this.tracking.voidClosedProcesses();
      const fulfilled = await this.tracking.markFulfilled();
      const overdue = await this.tracking.markOverdue(today);
      if (overdue.length) {
        await this.notifications.publish(overdue.flatMap((t) => this.escalation(t)));
        await this.audit.record({ action: 'LADDER_TASKS_OVERDUE', entity: 'collection_ladder', payload: { today, executions: overdue.map((o) => o.executionId) } });
      }
      if (voided || fulfilled || overdue.length) this.logger.log({ voided, fulfilled, overdue: overdue.length }, 'Cumprimento da régua actualizado');
      return { voided, fulfilled, overdue: overdue.length };
    });
  }

  private escalation(t: OverdueLadderTask): NewNotification[] {
    const base = { data: { executionId: t.executionId, processId: t.processId, agentId: t.agentId, dueOn: t.dueOn }, actionUrl: `/processes/${t.processId}` };
    const out: NewNotification[] = [];
    if (t.managerId) {
      out.push({ ...base, userId: t.managerId, type: 'ladder.task_overdue', priority: 'high', title: 'Passo da régua em atraso', message: `"${t.title}" — ${t.debtorName} (processo #${t.processId}): sem contacto registado até ${t.dueOn}.` });
    }
    if (t.agentId) {
      out.push({ ...base, userId: t.agentId, type: 'ladder.task_overdue', priority: 'high', title: 'Passo da régua em atraso', message: `"${t.title}" — ${t.debtorName} (processo #${t.processId}) passou o prazo (${t.dueOn}). Registe o contacto.` });
    }
    return out;
  }
}

const monthStart = (today: string) => `${today.slice(0, 8)}01`;

@Injectable()
export class LadderTrackingQueriesUseCase {
  constructor(private readonly tracking: LadderTracking, private readonly clock: Clock) {}

  tasks(me: AuthenticatedUser, f: { page: number; perPage: number; statuses?: LadderTaskStatus[]; agentId?: number; ladderId?: number; processId?: number; dueFrom?: string; dueTo?: string }) {
    return this.tracking.tasks({ ...f, scope: resolveTeamScope(me, LADDER_VIEW_ALL_PERMISSION) });
  }

  async compliance(me: AuthenticatedUser, q: { from?: string; to?: string; agentId?: number }) {
    const today = luandaToday(this.clock.now());
    const from = q.from ?? monthStart(today);
    const to = q.to ?? today;
    if (from > to) throw new ValidationError('"from" não pode ser depois de "to"');
    const rows = await this.tracking.compliance(resolveTeamScope(me, LADDER_VIEW_ALL_PERMISSION), from, to, q.agentId);
    return {
      period: { from, to },
      data: rows.map((r) => ({ ...r, complianceRate: complianceRate(r.fulfilledOnTime, r.fulfilledLate, r.overdue) })),
    };
  }
}
