import { auditDiff, prefixed } from './audit-diff';

describe('auditDiff', () => {
  it('guarda só os campos alterados', () => {
    const d = auditDiff(
      { id: 1, name: 'João', email: 'a@x.ao', amount: '100.00', updatedAt: '2026-01-01' },
      { id: 1, name: 'João', email: 'b@x.ao', amount: '100', updatedAt: '2026-02-01' },
    );
    expect(d).toEqual({ before: { email: 'a@x.ao' }, after: { email: 'b@x.ao' }, changedFields: ['email'] });
  });
  it('trata null, undefined e vazio como iguais e compara listas', () => {
    expect(auditDiff({ notes: null, steps: ['Dia 1: A'] }, { notes: '', steps: ['Dia 1: A'] }).changedFields).toEqual([]);
    expect(auditDiff({ steps: ['Dia 1: A'] }, { steps: ['Dia 1: B'] }).changedFields).toEqual(['steps']);
  });
  it('prefixa campos de registos filhos', () => {
    expect(prefixed('contact', { id: 3, debtorId: 1, name: 'Ana' })).toEqual({ contactName: 'Ana' });
  });
});
