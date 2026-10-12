import { BusinessRuleError, ValidationError } from '@/shared/domain/errors';

export const LADDER_ACTIONS = ['CONTACT_REMINDER', 'NEGOTIATION_SUGGESTION', 'ESCALATION', 'CUSTOM_ALERT'] as const;
export type LadderAction = (typeof LADDER_ACTIONS)[number];

export const LADDER_RECIPIENTS = ['AGENT', 'MANAGER', 'BOTH'] as const;
export type LadderRecipients = (typeof LADDER_RECIPIENTS)[number];

export const LADDER_PRIORITIES = ['low', 'medium', 'high'] as const;
export type LadderPriority = (typeof LADDER_PRIORITIES)[number];

/** Canal da mensagem enviada ao devedor nesse passo (além do alerta interno). */
export const DEBTOR_CHANNELS = ['NONE', 'EMAIL', 'SMS', 'EMAIL_SMS'] as const;
export type DebtorChannel = (typeof DEBTOR_CHANNELS)[number];
export const sendsEmail = (c: DebtorChannel | undefined) => c === 'EMAIL' || c === 'EMAIL_SMS';
export const sendsSms = (c: DebtorChannel | undefined) => c === 'SMS' || c === 'EMAIL_SMS';

/** Variáveis que o comercial pode usar nas mensagens. */
export const TEMPLATE_VARIABLES = ['debtorName', 'processId', 'day', 'totalAmount', 'invoicesCount'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export interface LadderStepInput {
  dayOffset: number;
  actionType: LadderAction;
  recipients: LadderRecipients;
  priority: LadderPriority;
  title: string;
  messageTemplate: string;
  /**
   * Prazo (dias) para o agente cumprir o passo registando um contacto no processo.
   * null/undefined = passo só informativo (não é acompanhado nem escalado).
   */
  fulfillmentDays?: number | null;
  /** mensagem ao devedor: canal, assunto (email) e texto — com as mesmas variáveis */
  debtorChannel?: DebtorChannel;
  debtorSubject?: string | null;
  debtorMessageTemplate?: string | null;
}

export const LADDER_LIMITS = { maxSteps: 50, maxDay: 3650, maxFulfillmentDays: 365 } as const;

/** Estado de acompanhamento de um passo executado num processo. */
export const LADDER_TASK_STATUSES = ['PENDING', 'FULFILLED', 'OVERDUE', 'VOID'] as const;
export type LadderTaskStatus = (typeof LADDER_TASK_STATUSES)[number];

const VAR_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * Regras puras de configuração de uma régua (sem I/O, testáveis).
 * Quem define as etapas é o utilizador; aqui só garantimos que são coerentes.
 */
export class LadderPolicy {
  static validateSteps(steps: LadderStepInput[]): LadderStepInput[] {
    if (!steps.length) throw new BusinessRuleError('A régua deve ter pelo menos uma etapa');
    if (steps.length > LADDER_LIMITS.maxSteps) throw new BusinessRuleError(`A régua pode ter no máximo ${LADDER_LIMITS.maxSteps} etapas`);
    const days = new Set<number>();
    for (const s of steps) {
      if (!Number.isInteger(s.dayOffset) || s.dayOffset < 0 || s.dayOffset > LADDER_LIMITS.maxDay) {
        throw new ValidationError(`Dia inválido (${s.dayOffset}): deve estar entre 0 e ${LADDER_LIMITS.maxDay}`);
      }
      if (days.has(s.dayOffset)) throw new BusinessRuleError(`Existe mais de uma etapa no dia ${s.dayOffset}`);
      if (s.fulfillmentDays != null && (!Number.isInteger(s.fulfillmentDays) || s.fulfillmentDays < 0 || s.fulfillmentDays > LADDER_LIMITS.maxFulfillmentDays)) {
        throw new ValidationError(`Prazo de cumprimento inválido na etapa do dia ${s.dayOffset}: 0 a ${LADDER_LIMITS.maxFulfillmentDays} dias`);
      }
      days.add(s.dayOffset);
      const channel = s.debtorChannel ?? 'NONE';
      if (channel !== 'NONE' && !s.debtorMessageTemplate?.trim()) {
        throw new BusinessRuleError(`Etapa do dia ${s.dayOffset}: escreva a mensagem a enviar ao devedor`);
      }
      const unknown = [...`${s.messageTemplate} ${s.debtorSubject ?? ''} ${s.debtorMessageTemplate ?? ''}`.matchAll(VAR_PATTERN)].map((m) => m[1]).filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v));
      if (unknown.length) {
        throw new ValidationError(`Variáveis desconhecidas na etapa do dia ${s.dayOffset}: ${unknown.join(', ')}. Disponíveis: ${TEMPLATE_VARIABLES.join(', ')}`);
      }
    }
    return [...steps].sort((a, b) => a.dayOffset - b.dayOffset).map((s) => {
      const channel = s.debtorChannel ?? 'NONE';
      return {
        ...s,
        fulfillmentDays: s.fulfillmentDays ?? null,
        debtorChannel: channel,
        debtorSubject: channel === 'NONE' ? null : s.debtorSubject?.trim() || null,
        debtorMessageTemplate: channel === 'NONE' ? null : s.debtorMessageTemplate?.trim() || null,
      };
    });
  }
}

/**
 * Taxa de cumprimento = cumpridos dentro do prazo ÷ passos já decididos (cumpridos + em atraso) × 100.
 * Pendentes (ainda no prazo) e anulados (processo fechado) não entram. Nada decidido → null.
 */
export const complianceRate = (onTime: number, late: number, overdue: number): string | null => {
  const decided = onTime + late + overdue;
  return decided ? ((onTime * 100) / decided).toFixed(2) : null;
};

const MONEY_PT = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valores das variáveis já formatados para leitura humana (PRC-00012, 250 000,00 Kz). */
export const templateVars = (r: { debtorName: string; processId: number; day: number; totalAmount: string | number; invoicesCount: number }): Record<TemplateVariable, string | number> => ({
  debtorName: r.debtorName,
  processId: `PRC-${String(r.processId).padStart(5, '0')}`,
  day: r.day,
  totalAmount: `${MONEY_PT.format(Number(r.totalAmount ?? 0))} Kz`,
  invoicesCount: r.invoicesCount,
});

/** Substitui {{variavel}} pelos valores do processo (variáveis desconhecidas já foram rejeitadas). */
export const renderTemplate = (template: string, vars: Record<TemplateVariable, string | number>): string =>
  template.replace(VAR_PATTERN, (_m, name: string) => String(vars[name as TemplateVariable] ?? ''));

/** Destinatários concretos de uma execução (o gestor só se existir). */
export const resolveRecipients = (r: LadderRecipients, agentId: number, managerId: number | null): number[] => {
  const ids = r === 'AGENT' ? [agentId] : r === 'MANAGER' ? [managerId] : [agentId, managerId];
  return [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
};
