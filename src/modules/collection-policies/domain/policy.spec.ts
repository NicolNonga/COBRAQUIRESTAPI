import { assertLadderCompliant, channelAllowed, checkLadder, CollectionPolicy, skeletonSteps, validatePolicy } from './policy';

const policy = (over: Partial<CollectionPolicy> = {}): CollectionPolicy => ({
  name: 'Master', description: null, version: 3, updatedAt: new Date(),
  graceDays: 5, maxCollectionDays: 90, maxSteps: 4, maxContactsPerProcess: 10,
  allowedDebtorChannels: ['EMAIL'], minDaysBetweenDebtorMessages: 7,
  rules: [
    { actionType: 'CONTACT_REMINDER', minDay: 1, maxDay: 30, maxFulfillmentDays: 3, required: true },
    { actionType: 'ESCALATION', minDay: 15, maxDay: 60, maxFulfillmentDays: null, required: false },
  ],
  ...over,
});
const codes = (p: CollectionPolicy, steps: any[]) => checkLadder(p, steps).map((v) => v.code);

describe('régua master — conformidade das réguas filhas', () => {
  it('aceita uma régua dentro dos limites', () => {
    expect(codes(policy(), [
      { dayOffset: 2, actionType: 'CONTACT_REMINDER', fulfillmentDays: 2, debtorChannel: 'EMAIL' },
      { dayOffset: 20, actionType: 'ESCALATION', fulfillmentDays: null, debtorChannel: 'NONE' },
    ])).toEqual([]);
  });

  it('rejeita tipo não permitido, dia fora da janela e dia depois do limite', () => {
    const c = codes(policy(), [
      { dayOffset: 2, actionType: 'CONTACT_REMINDER', fulfillmentDays: 2 },
      { dayOffset: 5, actionType: 'ESCALATION' },
      { dayOffset: 20, actionType: 'CUSTOM_ALERT' },
      { dayOffset: 95, actionType: 'ESCALATION' },
    ]);
    expect(c).toEqual(expect.arrayContaining(['DAY_OUT_OF_WINDOW', 'ACTION_NOT_ALLOWED', 'DAY_AFTER_LIMIT']));
  });

  it('exige prazo de cumprimento e respeita o máximo', () => {
    expect(codes(policy(), [{ dayOffset: 2, actionType: 'CONTACT_REMINDER', fulfillmentDays: null }])).toContain('FULFILLMENT_REQUIRED');
    expect(codes(policy(), [{ dayOffset: 2, actionType: 'CONTACT_REMINDER', fulfillmentDays: 9 }])).toContain('FULFILLMENT_TOO_LONG');
  });

  it('limita o número de passos', () => {
    const steps = [1, 2, 3, 4, 5].map((d) => ({ dayOffset: d, actionType: 'CONTACT_REMINDER', fulfillmentDays: 1 }));
    expect(codes(policy(), steps)).toContain('TOO_MANY_STEPS');
  });

  it('controla canais e intervalo mínimo entre mensagens ao devedor', () => {
    const sms = [{ dayOffset: 2, actionType: 'CONTACT_REMINDER', fulfillmentDays: 1, debtorChannel: 'SMS' }];
    expect(codes(policy(), sms)).toContain('CHANNEL_NOT_ALLOWED');
    const close = [
      { dayOffset: 2, actionType: 'CONTACT_REMINDER', fulfillmentDays: 1, debtorChannel: 'EMAIL' },
      { dayOffset: 5, actionType: 'CONTACT_REMINDER', fulfillmentDays: 1, debtorChannel: 'EMAIL' },
    ];
    expect(codes(policy(), close)).toContain('MESSAGES_TOO_CLOSE');
    expect(codes(policy({ minDaysBetweenDebtorMessages: 3 }), close)).not.toContain('MESSAGES_TOO_CLOSE');
  });

  it('exige os passos obrigatórios', () => {
    expect(codes(policy(), [{ dayOffset: 20, actionType: 'ESCALATION' }])).toContain('REQUIRED_STEP_MISSING');
  });

  it('assertLadderCompliant lança 422 com a lista completa', () => {
    try {
      assertLadderCompliant(policy(), [{ dayOffset: 95, actionType: 'CUSTOM_ALERT' }]);
      fail('devia lançar');
    } catch (e: any) {
      expect(e.code).toBe('BUSINESS_RULE_VIOLATION');
      expect(e.details.violations.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('EMAIL_SMS exige os dois canais; NONE é sempre livre', () => {
    expect(channelAllowed(['EMAIL'], 'EMAIL_SMS')).toBe(false);
    expect(channelAllowed(['EMAIL', 'SMS'], 'EMAIL_SMS')).toBe(true);
    expect(channelAllowed([], 'NONE')).toBe(true);
  });

  it('o esqueleto traz os passos obrigatórios', () => {
    expect(skeletonSteps(policy())).toEqual([{ dayOffset: 1, actionType: 'CONTACT_REMINDER', fulfillmentDays: 3 }]);
  });
});

describe('régua master — validação da própria política', () => {
  const input = () => {
    const { version, updatedAt, ...rest } = policy();
    return rest;
  };
  it('aceita uma política coerente', () => expect(() => validatePolicy(input())).not.toThrow());
  it('rejeita janela invertida e dia acima da duração máxima', () => {
    const bad = input();
    bad.rules = [{ actionType: 'ESCALATION', minDay: 40, maxDay: 20, maxFulfillmentDays: null, required: false }];
    expect(() => validatePolicy(bad)).toThrow(/mínimo/);
    bad.rules = [{ actionType: 'ESCALATION', minDay: 1, maxDay: 200, maxFulfillmentDays: null, required: false }];
    expect(() => validatePolicy(bad)).toThrow(/duração máxima/);
  });
  it('rejeita tipos repetidos e política sem regras', () => {
    const dup = input();
    dup.rules = [dup.rules[0], dup.rules[0]];
    expect(() => validatePolicy(dup)).toThrow(/repetido/);
    expect(() => validatePolicy({ ...input(), rules: [] })).toThrow(/pelo menos um/);
  });
});
