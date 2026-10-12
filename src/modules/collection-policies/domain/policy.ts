import { BusinessRuleError, ValidationError } from '@/shared/domain/errors';

/**
 * Régua MASTER (política de cobrança): única, definida pelo administrador.
 * As réguas dos comerciais/gestores (filhas) só são aceites se cumprirem estes limites.
 * Regras puras (sem I/O) — testáveis.
 */
export const POLICY_ACTIONS = ['CONTACT_REMINDER', 'NEGOTIATION_SUGGESTION', 'ESCALATION', 'CUSTOM_ALERT'] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

/** canais que a política autoriza (EMAIL_SMS = os dois) */
export const POLICY_CHANNELS = ['EMAIL', 'SMS'] as const;
export type PolicyChannel = (typeof POLICY_CHANNELS)[number];

export const POLICY_LIMITS = { maxSteps: 50, maxDay: 3650, maxFulfillment: 365, maxGrace: 365, maxContacts: 1000 } as const;

export interface PolicyStepRule {
  actionType: PolicyAction;
  minDay: number;
  maxDay: number;
  /** prazo máximo para o agente cumprir o passo; null = livre (o passo pode até ser só informativo) */
  maxFulfillmentDays: number | null;
  /** a régua tem de ter pelo menos um passo deste tipo dentro da janela */
  required: boolean;
}

export interface PolicyInput {
  name: string;
  description: string | null;
  graceDays: number;
  maxCollectionDays: number;
  maxSteps: number;
  maxContactsPerProcess: number | null;
  allowedDebtorChannels: PolicyChannel[];
  minDaysBetweenDebtorMessages: number;
  rules: PolicyStepRule[];
}

export interface CollectionPolicy extends PolicyInput {
  version: number;
  updatedAt: Date;
}

export interface PolicyViolation {
  code: 'TOO_MANY_STEPS' | 'ACTION_NOT_ALLOWED' | 'DAY_OUT_OF_WINDOW' | 'DAY_AFTER_LIMIT' | 'FULFILLMENT_REQUIRED' | 'FULFILLMENT_TOO_LONG' | 'CHANNEL_NOT_ALLOWED' | 'MESSAGES_TOO_CLOSE' | 'REQUIRED_STEP_MISSING';
  message: string;
  dayOffset?: number;
}

export interface StepToCheck {
  dayOffset: number;
  actionType: string;
  fulfillmentDays?: number | null;
  debtorChannel?: string | null;
}

const ACTION_LABEL: Record<PolicyAction, string> = {
  CONTACT_REMINDER: 'Lembrete de contacto',
  NEGOTIATION_SUGGESTION: 'Sugestão de negociação',
  ESCALATION: 'Escalada ao gestor',
  CUSTOM_ALERT: 'Alerta personalizado',
};
export const actionLabel = (a: string): string => ACTION_LABEL[a as PolicyAction] ?? a;

const inRange = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** o canal da mensagem ao devedor é permitido pela política? ('NONE' é sempre permitido) */
export const channelAllowed = (allowed: readonly string[], channel: string | null | undefined): boolean => {
  if (!channel || channel === 'NONE') return true;
  if (channel === 'EMAIL_SMS') return allowed.includes('EMAIL') && allowed.includes('SMS');
  return allowed.includes(channel);
};

/** Valida (e normaliza) a própria política antes de a gravar. */
export const validatePolicy = (p: PolicyInput): PolicyInput => {
  if (!p.name?.trim()) throw new ValidationError('A régua master precisa de um nome');
  if (!inRange(p.graceDays, 0, POLICY_LIMITS.maxGrace)) throw new ValidationError(`Dias de tolerância: 0 a ${POLICY_LIMITS.maxGrace}`);
  if (!inRange(p.maxCollectionDays, 1, POLICY_LIMITS.maxDay)) throw new ValidationError(`Duração máxima da cobrança: 1 a ${POLICY_LIMITS.maxDay} dias`);
  if (!inRange(p.maxSteps, 1, POLICY_LIMITS.maxSteps)) throw new ValidationError(`Máximo de passos: 1 a ${POLICY_LIMITS.maxSteps}`);
  if (p.maxContactsPerProcess != null && !inRange(p.maxContactsPerProcess, 1, POLICY_LIMITS.maxContacts)) {
    throw new ValidationError(`Máximo de contactos por processo: 1 a ${POLICY_LIMITS.maxContacts} (ou sem limite)`);
  }
  if (!inRange(p.minDaysBetweenDebtorMessages, 0, 365)) throw new ValidationError('Intervalo entre mensagens ao devedor: 0 a 365 dias');
  if (p.allowedDebtorChannels.some((c) => !(POLICY_CHANNELS as readonly string[]).includes(c))) throw new ValidationError('Canal inválido (use EMAIL e/ou SMS)');
  if (!p.rules.length) throw new BusinessRuleError('Defina pelo menos um tipo de passo permitido');
  const seen = new Set<string>();
  for (const r of p.rules) {
    const label = actionLabel(r.actionType);
    if (!(POLICY_ACTIONS as readonly string[]).includes(r.actionType)) throw new ValidationError(`Tipo de passo inválido: ${r.actionType}`);
    if (seen.has(r.actionType)) throw new BusinessRuleError(`"${label}" está repetido`);
    seen.add(r.actionType);
    if (!inRange(r.minDay, 0, POLICY_LIMITS.maxDay) || !inRange(r.maxDay, 0, POLICY_LIMITS.maxDay)) throw new ValidationError(`${label}: dias entre 0 e ${POLICY_LIMITS.maxDay}`);
    if (r.minDay > r.maxDay) throw new BusinessRuleError(`${label}: o dia mínimo (${r.minDay}) não pode ser maior que o máximo (${r.maxDay})`);
    if (r.maxDay > p.maxCollectionDays) throw new BusinessRuleError(`${label}: o dia máximo (${r.maxDay}) passa a duração máxima da cobrança (${p.maxCollectionDays} dias)`);
    if (r.maxFulfillmentDays != null && !inRange(r.maxFulfillmentDays, 0, POLICY_LIMITS.maxFulfillment)) {
      throw new ValidationError(`${label}: prazo de cumprimento entre 0 e ${POLICY_LIMITS.maxFulfillment} dias`);
    }
  }
  return {
    ...p,
    name: p.name.trim(),
    description: p.description?.trim() || null,
    allowedDebtorChannels: [...new Set(p.allowedDebtorChannels)],
    rules: [...p.rules].sort((a, b) => POLICY_ACTIONS.indexOf(a.actionType) - POLICY_ACTIONS.indexOf(b.actionType)),
  };
};

/** Todas as violações de uma régua filha face à master (lista vazia = cumpre). */
export const checkLadder = (policy: CollectionPolicy, steps: StepToCheck[]): PolicyViolation[] => {
  const out: PolicyViolation[] = [];
  if (steps.length > policy.maxSteps) {
    out.push({ code: 'TOO_MANY_STEPS', message: `A régua tem ${steps.length} passos; a régua master permite no máximo ${policy.maxSteps}.` });
  }
  const rules = new Map(policy.rules.map((r) => [r.actionType as string, r]));
  const sorted = [...steps].sort((a, b) => a.dayOffset - b.dayOffset);

  for (const s of sorted) {
    const d = s.dayOffset;
    if (d > policy.maxCollectionDays) {
      out.push({ code: 'DAY_AFTER_LIMIT', dayOffset: d, message: `Dia ${d}: passa a duração máxima da cobrança (${policy.maxCollectionDays} dias).` });
    }
    const rule = rules.get(s.actionType);
    if (!rule) {
      out.push({ code: 'ACTION_NOT_ALLOWED', dayOffset: d, message: `Dia ${d}: o tipo "${actionLabel(s.actionType)}" não é permitido pela régua master.` });
    } else {
      if (d < rule.minDay || d > rule.maxDay) {
        out.push({ code: 'DAY_OUT_OF_WINDOW', dayOffset: d, message: `Dia ${d}: "${actionLabel(s.actionType)}" só pode ocorrer entre o dia ${rule.minDay} e o dia ${rule.maxDay}.` });
      }
      if (rule.maxFulfillmentDays != null) {
        if (s.fulfillmentDays == null) {
          out.push({ code: 'FULFILLMENT_REQUIRED', dayOffset: d, message: `Dia ${d}: defina o prazo de cumprimento (máximo ${rule.maxFulfillmentDays} dias).` });
        } else if (s.fulfillmentDays > rule.maxFulfillmentDays) {
          out.push({ code: 'FULFILLMENT_TOO_LONG', dayOffset: d, message: `Dia ${d}: prazo de cumprimento de ${s.fulfillmentDays} dias; o máximo é ${rule.maxFulfillmentDays}.` });
        }
      }
    }
    if (!channelAllowed(policy.allowedDebtorChannels, s.debtorChannel)) {
      out.push({ code: 'CHANNEL_NOT_ALLOWED', dayOffset: d, message: `Dia ${d}: o canal ${s.debtorChannel} ao devedor não é permitido pela régua master.` });
    }
  }

  // intervalo mínimo entre mensagens ao devedor
  if (policy.minDaysBetweenDebtorMessages > 0) {
    const msgs = sorted.filter((s) => s.debtorChannel && s.debtorChannel !== 'NONE');
    for (let i = 1; i < msgs.length; i++) {
      const gap = msgs[i].dayOffset - msgs[i - 1].dayOffset;
      if (gap < policy.minDaysBetweenDebtorMessages) {
        out.push({
          code: 'MESSAGES_TOO_CLOSE',
          dayOffset: msgs[i].dayOffset,
          message: `Dia ${msgs[i].dayOffset}: só ${gap} dia(s) após a mensagem do dia ${msgs[i - 1].dayOffset}; o intervalo mínimo ao devedor é ${policy.minDaysBetweenDebtorMessages} dias.`,
        });
      }
    }
  }

  for (const r of policy.rules.filter((x) => x.required)) {
    if (!sorted.some((s) => s.actionType === r.actionType && s.dayOffset >= r.minDay && s.dayOffset <= r.maxDay)) {
      out.push({ code: 'REQUIRED_STEP_MISSING', message: `Falta um passo "${actionLabel(r.actionType)}" entre o dia ${r.minDay} e o dia ${r.maxDay} (obrigatório).` });
    }
  }
  return out;
};

/** Lança 422 com a lista completa de violações (a interface mostra-as todas de uma vez). */
export const assertLadderCompliant = (policy: CollectionPolicy, steps: StepToCheck[]): void => {
  const violations = checkLadder(policy, steps);
  if (violations.length) {
    throw new BusinessRuleError(
      `A régua não cumpre a régua master (${violations.length} ${violations.length === 1 ? 'problema' : 'problemas'}): ${violations[0].message}`,
      { violations },
    );
  }
};

/** Passos obrigatórios já colocados no primeiro dia permitido — ponto de partida para o comercial. */
export const skeletonSteps = (policy: CollectionPolicy): Array<{ dayOffset: number; actionType: PolicyAction; fulfillmentDays: number | null }> =>
  policy.rules.filter((r) => r.required).map((r) => ({ dayOffset: r.minDay, actionType: r.actionType, fulfillmentDays: r.maxFulfillmentDays }));
