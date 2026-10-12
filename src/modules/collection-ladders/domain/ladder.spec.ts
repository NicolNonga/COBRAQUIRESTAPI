import { complianceRate, LadderPolicy, LadderStepInput, renderTemplate, resolveRecipients } from './ladder';

const step = (dayOffset: number, messageTemplate = 'Ligar a {{debtorName}}'): LadderStepInput => ({
  dayOffset, actionType: 'CONTACT_REMINDER', recipients: 'AGENT', priority: 'medium', title: 't', messageTemplate,
});

describe('LadderPolicy', () => {
  it('ordena as etapas por dia', () => {
    expect(LadderPolicy.validateSteps([step(10), step(1), step(5)]).map((s) => s.dayOffset)).toEqual([1, 5, 10]);
  });
  it('rejeita régua vazia, dias repetidos e dias negativos', () => {
    expect(() => LadderPolicy.validateSteps([])).toThrow(/pelo menos uma/);
    expect(() => LadderPolicy.validateSteps([step(3), step(3)])).toThrow(/dia 3/);
    expect(() => LadderPolicy.validateSteps([step(-1)])).toThrow(/Dia inválido/);
  });
  it('rejeita variáveis desconhecidas no template', () => {
    expect(() => LadderPolicy.validateSteps([step(1, 'Olá {{variavelInexistente}}')])).toThrow(/variavelInexistente/);
  });
});

describe('renderTemplate / resolveRecipients', () => {
  it('substitui as variáveis', () => {
    expect(renderTemplate('Ligar a {{debtorName}} ({{ totalAmount }}), dia {{day}}', { debtorName: 'ACME', processId: 1, day: 5, totalAmount: '1500.00', invoicesCount: 2 }))
      .toBe('Ligar a ACME (1500.00), dia 5');
  });
  it('resolve destinatários e ignora gestor inexistente', () => {
    expect(resolveRecipients('BOTH', 3, 2)).toEqual([3, 2]);
    expect(resolveRecipients('BOTH', 3, null)).toEqual([3]);
    expect(resolveRecipients('MANAGER', 3, null)).toEqual([]);
  });
});

describe('cumprimento dos passos', () => {
  it('prazo opcional: vazio → passo informativo (null)', () => {
    const [s] = LadderPolicy.validateSteps([step(1)]);
    expect(s.fulfillmentDays).toBeNull();
    expect(LadderPolicy.validateSteps([{ ...step(1), fulfillmentDays: 2 }])[0].fulfillmentDays).toBe(2);
  });
  it('rejeita prazos inválidos', () => {
    expect(() => LadderPolicy.validateSteps([{ ...step(1), fulfillmentDays: -1 }])).toThrow(/Prazo/);
    expect(() => LadderPolicy.validateSteps([{ ...step(1), fulfillmentDays: 1.5 }])).toThrow(/Prazo/);
  });
  it('taxa de cumprimento = no prazo ÷ decididos', () => {
    expect(complianceRate(3, 1, 0)).toBe('75.00');
    expect(complianceRate(0, 0, 0)).toBeNull();
    expect(complianceRate(1, 1, 1)).toBe('33.33');
  });
});
