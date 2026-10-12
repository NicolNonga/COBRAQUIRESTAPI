import { DataSource } from 'typeorm';
import { resolveAuditReferences } from './audit-references';

describe('resolveAuditReferences', () => {
  const ds = {
    query: jest.fn(async (sql: string, [ids]: [number[]]) => {
      if (sql.includes('FROM debtors')) return ids.filter((i) => i === 1).map((id) => ({ id, label: 'João Manuel' }));
      if (sql.includes('FROM invoices')) return ids.map((id) => ({ id, label: 'FT 009483' }));
      if (sql.includes('FROM currencies')) return ids.map((id) => ({ id, label: `Moeda ${id}` }));
      return [];
    }),
  } as unknown as DataSource;

  it('troca ids por nomes no topo do payload, em before/after e na entidade', async () => {
    const [r] = await resolveAuditReferences(ds, [
      { entity: 'invoice', entityId: '5', payload: { debtorId: 1, amount: '10000.00', before: { currencyId: 1 }, after: { currencyId: 2 } } },
    ]);
    expect(r.entityLabel).toBe('FT 009483');
    expect(r.references).toEqual({ debtorId: 'João Manuel', 'before.currencyId': 'Moeda 1', 'after.currencyId': 'Moeda 2' });
  });

  it('indica registo removido quando o id já não existe e agrupa listas', async () => {
    const [r] = await resolveAuditReferences(ds, [{ entity: 'wallet', entityId: null, payload: { debtorIds: [1, 9] } }]);
    expect(r.references.debtorIds).toBe('João Manuel, Registo removido (#9)');
    expect(r.entityLabel).toBeNull();
  });
});
