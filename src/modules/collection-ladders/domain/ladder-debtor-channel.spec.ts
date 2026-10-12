import { LadderPolicy, LadderStepInput, renderTemplate, templateVars } from './ladder';

const step = (p: Partial<LadderStepInput> = {}): LadderStepInput => ({
  dayOffset: 1, actionType: 'CONTACT_REMINDER', recipients: 'AGENT', priority: 'medium', title: 'Aviso', messageTemplate: 'Contactar {{debtorName}}', ...p,
});

describe('Régua — mensagem ao devedor', () => {
  it('sem canal limpa assunto e texto', () => {
    const [s] = LadderPolicy.validateSteps([step({ debtorSubject: 'x', debtorMessageTemplate: 'y' })]);
    expect(s).toMatchObject({ debtorChannel: 'NONE', debtorSubject: null, debtorMessageTemplate: null });
  });
  it('com canal exige texto', () => {
    expect(() => LadderPolicy.validateSteps([step({ debtorChannel: 'EMAIL' })])).toThrow(/mensagem a enviar ao devedor/);
  });
  it('rejeita variáveis desconhecidas no texto ao devedor', () => {
    expect(() => LadderPolicy.validateSteps([step({ debtorChannel: 'SMS', debtorMessageTemplate: 'Olá {{nome}}' })])).toThrow(/Variáveis desconhecidas/);
  });
  it('formata as variáveis para o devedor', () => {
    const t = renderTemplate('Caro(a) {{debtorName}}, {{processId}} tem {{totalAmount}} em atraso.', templateVars({ debtorName: 'João', processId: 12, day: 3, totalAmount: '250000.00', invoicesCount: 2 }));
    expect(t).toMatch(/^Caro\(a\) João, PRC-00012 tem 250.000,00 Kz em atraso\.$|^Caro\(a\) João, PRC-00012 tem 250\s000,00 Kz em atraso\.$/);
  });
});
