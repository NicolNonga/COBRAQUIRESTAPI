import { ContactRestrictions } from '@/shared/application/contact-restrictions.port';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { DebtorMessagePayload, MessageTypes, Outbox, OutboxMessageInput } from '@/shared/application/outbox.port';
import { renderTemplate, resolveRecipients, sendsEmail, sendsSms, templateVars } from '../domain/ladder';
import { LadderEngine } from '../domain/ladder.repository';
import { luandaToday } from './luanda-date';
import { ProcessStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { ProcessCommandRepository } from '@/modules/processes/domain/process.repository';

/**
 * Motor da régua (job diário):
 *  1. regista as etapas devidas hoje (idempotente; outra réplica em paralelo não recebe nada);
 *  2. publica as notificações para agente/gestor via outbox — NA MESMA transacção.
 * Ou ficam as duas coisas gravadas, ou nenhuma: nunca "executado mas não avisado".
 */
@Injectable()
export class RunCollectionLaddersUseCase {
  private readonly logger = new Logger(RunCollectionLaddersUseCase.name);
  private readonly catchUp: number;

  constructor(
    private readonly engine: LadderEngine,
    private readonly processes: ProcessCommandRepository,
    private readonly states: StateCatalog,
    private readonly notifications: NotificationPublisher,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    private readonly outbox: Outbox,
    private readonly restrictions: ContactRestrictions,
    cfg: ConfigService,
  ) {
    this.catchUp = Number(cfg.get('LADDER_CATCHUP_DAYS', 2));
  }

  execute(): Promise<{ executed: number; notifications: number; debtorMessages?: number; limitExceeded?: number }> {
    const today = luandaToday(this.clock.now());
    return this.uow.run(async () => {
      // processos que ultrapassaram a duração máxima da régua master → avisa o responsável e o gestor (1×)
      const exceeded = await this.engine.claimLimitExceeded(today);
      if (exceeded.length) {
        await this.notifications.publish(
          exceeded.flatMap((e) =>
            [...new Set([e.agentId, e.managerId].filter((x): x is number => typeof x === 'number'))].map((userId) => ({
              userId,
              type: 'policy.max_days_exceeded',
              title: 'Cobrança acima do prazo máximo',
              message: `O processo PRC-${String(e.processId).padStart(5, '0')} (${e.debtorName}) está há ${e.day} dias em cobrança; o máximo da régua master é ${e.maxDays}. Decida o encaminhamento (negociação, jurídico ou perda).`,
              priority: 'high' as const,
              data: { processId: e.processId, day: e.day, maxDays: e.maxDays },
              actionUrl: `/processes/${e.processId}`,
            })),
          ),
        );
      }
      const due = await this.engine.claimDueSteps(today, this.catchUp);
      if (!due.length) return { executed: 0, notifications: 0, limitExceeded: exceeded.length };

      // a régua executou um passo nestes processos: a cobrança arrancou (REGISTADO → "Em cobrança")
      const [registered, inProgress] = await Promise.all([
        this.states.processStateId(ProcessStateCode.REGISTERED),
        this.states.processStateId(ProcessStateCode.IN_PROGRESS),
      ]);
      const started = await this.processes.startCollection([...new Set(due.map((d) => d.processId))], registered, inProgress);
      if (started) await this.audit.record({ action: 'PROCESS_COLLECTION_STARTED', entity: 'process', payload: { count: started, reason: 'LADDER' } });

      const items = due.flatMap((d) => {
        const rendered = renderTemplate(d.messageTemplate, templateVars(d));
        const message = d.fulfillmentDays == null ? rendered : `${rendered} (prazo: registar contacto em ${d.fulfillmentDays} dia(s))`;
        return resolveRecipients(d.recipients, d.agentId, d.managerId).map((userId) => ({
          userId,
          type: `ladder.${d.actionType.toLowerCase()}`,
          title: d.title,
          message,
          priority: d.priority,
          data: { processId: d.processId, stepId: d.stepId, day: d.day, actionType: d.actionType, agentId: d.agentId, fulfillmentDays: d.fulfillmentDays },
          actionUrl: `/processes/${d.processId}`,
        }));
      });
      // 1 mensagem de outbox para todas as notificações do dia (o handler grava em lote)
      await this.notifications.publish(items);

      // mensagens ao devedor (email / SMS) — também pela outbox, na mesma transacção
      // Lei 22/11, art. 27.º: devedores que se opuseram não recebem mensagens nesse canal
      const blocked = await this.restrictions.blocked(due.map((d) => d.debtorId));
      let suppressed = 0;
      const debtorMessages: OutboxMessageInput<DebtorMessagePayload>[] = due.flatMap((d) => {
        if (!d.debtorMessageTemplate || (!sendsEmail(d.debtorChannel) && !sendsSms(d.debtorChannel))) return [];
        const no = blocked.get(d.debtorId);
        const vars = templateVars(d);
        const base = { debtorId: d.debtorId, debtorName: d.debtorName, processId: d.processId, stepId: d.stepId, text: renderTemplate(d.debtorMessageTemplate, vars) };
        const out: OutboxMessageInput<DebtorMessagePayload>[] = [];
        if (sendsEmail(d.debtorChannel) && d.debtorEmail && !no?.has('EMAIL')) {
          out.push({
            type: MessageTypes.DEBTOR_EMAIL,
            dedupKey: `ladder:${d.processId}:${d.stepId}:email`,
            payload: { ...base, to: d.debtorEmail, subject: renderTemplate(d.debtorSubject || 'Aviso de cobrança — {{processId}}', vars) },
          });
        }
        if (sendsSms(d.debtorChannel) && d.debtorPhone && !no?.has('SMS')) {
          out.push({ type: MessageTypes.DEBTOR_SMS, dedupKey: `ladder:${d.processId}:${d.stepId}:sms`, payload: { ...base, to: d.debtorPhone } });
        }
        suppressed += (sendsEmail(d.debtorChannel) && d.debtorEmail ? 1 : 0) + (sendsSms(d.debtorChannel) && d.debtorPhone ? 1 : 0) - out.length;
        return out;
      });
      if (debtorMessages.length) await this.outbox.enqueueMany(debtorMessages);

      const summary = { today, executed: due.length, notifications: items.length, debtorMessages: debtorMessages.length, suppressedByOpposition: suppressed, limitExceeded: exceeded.length };
      await this.audit.record({ action: 'LADDER_STEPS_EXECUTED', entity: 'collection_ladder', payload: summary });
      this.logger.log(summary, 'Régua de cobrança executada');
      return summary;
    });
  }
}
