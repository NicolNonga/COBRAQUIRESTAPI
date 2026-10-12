import { Injectable, Logger } from '@nestjs/common';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { NewNotification } from '@/modules/notifications/domain/notification.repository';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { checkLadder, CollectionPolicy, PolicyInput, skeletonSteps, validatePolicy } from '@/modules/collection-policies/domain/policy';
import { PolicyRepository } from '@/modules/collection-policies/domain/policy.repository';
import { auditDiff } from '@/shared/application/audit-diff';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ConflictError, NotFoundError } from '@/shared/domain/errors';
import { LadderRepository } from '../domain/ladder.repository';

@Injectable()
export class PolicyQueriesUseCase {
  constructor(private readonly policies: PolicyRepository) {}

  async get() {
    const policy = await this.policies.get();
    if (!policy) throw new NotFoundError('A régua master ainda não foi definida');
    return { ...policy, skeleton: skeletonSteps(policy) };
  }
}

export interface PolicyUpdateResult {
  version: number;
  revalidated: number;
  suspended: number;
  restored: number;
}

@Injectable()
export class UpdatePolicyUseCase {
  private readonly logger = new Logger(UpdatePolicyUseCase.name);

  constructor(
    private readonly policies: PolicyRepository,
    private readonly ladders: LadderRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * Altera a régua master (lock optimista por versão) e, na MESMA transacção, revalida todas as réguas filhas:
   * as que deixam de cumprir são suspensas (o motor ignora-as) e o dono + gestor são avisados;
   * as que voltam a cumprir (política relaxada) são repostas.
   */
  execute(me: AuthenticatedUser, expectedVersion: number, raw: PolicyInput): Promise<PolicyUpdateResult> {
    const input = validatePolicy(raw);
    return this.uow.run(async () => {
      const current = await this.policies.getForUpdate();
      if (current && current.version !== expectedVersion) {
        throw new ConflictError(`A régua master foi alterada entretanto (versão actual ${current.version}). Recarregue e tente de novo.`);
      }
      const saved = await this.policies.save(input, me.id);
      const summary = (p: CollectionPolicy | PolicyInput | null) =>
        p && {
          name: p.name, graceDays: p.graceDays, maxCollectionDays: p.maxCollectionDays, maxSteps: p.maxSteps,
          maxContactsPerProcess: p.maxContactsPerProcess, allowedDebtorChannels: p.allowedDebtorChannels.join(','),
          minDaysBetweenDebtorMessages: p.minDaysBetweenDebtorMessages,
          rules: p.rules.map((r) => `${r.actionType}: dia ${r.minDay}-${r.maxDay}, prazo ${r.maxFulfillmentDays ?? 'livre'}${r.required ? ', obrigatório' : ''}`),
        };

      const result = await this.revalidateLadders(saved);
      await this.audit.record({
        action: 'COLLECTION_POLICY_UPDATED',
        entity: 'collection_policy',
        entityId: 1,
        payload: { fromVersion: current?.version ?? null, ...auditDiff(summary(current) ?? null, summary(saved) ?? null), ...result },
      });
      this.logger.log({ ...result, version: saved.version }, 'Régua master actualizada');
      return { version: saved.version, ...result };
    });
  }

  private async revalidateLadders(policy: CollectionPolicy): Promise<{ revalidated: number; suspended: number; restored: number }> {
    const ladders = await this.ladders.listAllWithSteps();
    const notify: NewNotification[] = [];
    let suspended = 0;
    let restored = 0;
    for (const l of ladders) {
      const violations = checkLadder(policy, l.steps ?? []);
      const ok = violations.length === 0;
      await this.ladders.setCompliance(l.id, ok, ok ? null : violations, policy.version);
      if (!ok && l.policyCompliant) {
        suspended++;
        if (!l.isActive) continue; // rascunho: nada a suspender, fica só marcada
        const managerId = await this.users.managerOf(l.ownerUserId);
        for (const userId of [...new Set([l.ownerUserId, managerId].filter((x): x is number => typeof x === 'number'))]) {
          notify.push({
            userId,
            type: 'policy.ladder_suspended',
            title: 'Régua suspensa: não cumpre a régua master',
            message: `A régua «${l.name}» deixou de cumprir os limites da régua master e foi suspensa até ser corrigida. ${violations[0].message}`,
            priority: 'high',
            data: { ladderId: l.id, violations: violations.length },
            actionUrl: `/ladders/${l.id}`,
          });
        }
      } else if (ok && !l.policyCompliant) {
        restored++;
      }
    }
    if (notify.length) await this.notifications.publish(notify);
    return { revalidated: ladders.length, suspended, restored };
  }
}
