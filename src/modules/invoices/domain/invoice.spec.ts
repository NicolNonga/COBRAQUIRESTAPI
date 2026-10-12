import { addDays, InvoiceFactory, overdueDays } from './invoice';

describe('InvoiceFactory', () => {
  const ok = { referenceNumber: ' FT 1 ', amount: '150000.5', issueDate: '2026-01-31', timeLimitDays: 30, debtorId: 1, currencyId: 1, invoiceStateId: 2, createdById: 1 };
  it('calcula vencimento e normaliza valor', () => {
    const i = InvoiceFactory.build(ok);
    expect(i.dueDate).toBe('2026-03-02');
    expect(i.amount).toBe('150000.50');
    expect(i.referenceNumber).toBe('FT 1');
  });
  it('rejeita valor zero/negativo', () => {
    expect(() => InvoiceFactory.build({ ...ok, amount: '0' })).toThrow();
  });
  it('dias de atraso', () => {
    expect(overdueDays('2026-10-01', '2026-10-05')).toBe(4);
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});
