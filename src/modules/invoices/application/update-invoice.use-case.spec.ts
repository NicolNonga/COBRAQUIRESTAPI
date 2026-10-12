import { InvoiceStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError } from '@/shared/domain/errors';
import { EditableInvoice, InvoiceRepository } from '../domain/invoice.repository';
import { UpdateInvoiceUseCase } from './update-invoice.use-case';

const base: EditableInvoice = {
  id: 1, referenceNumber: 'FT 1', amount: '10000.00', issueDate: '2026-09-01', timeLimitDays: 30, dueDate: '2026-10-01',
  debtorId: 1, currencyId: 1, inProcess: false, stateCode: InvoiceStateCode.OVERDUE,
};
const input = { refencence_number: 'FT 1', amount: '10000.00', issue_date: '2026-09-01', time_limit: 30, debtor_id: 1, currency_id: 1 };

function setup(cur: Partial<EditableInvoice> = {}, proc: { processId: number; activeNegotiationId: number | null } | null = null) {
  const repo = {
    findForUpdate: jest.fn().mockResolvedValue({ ...base, ...cur }),
    update: jest.fn(),
    processOf: jest.fn().mockResolvedValue(proc),
    detachFromProcess: jest.fn(),
  } as unknown as InvoiceRepository;
  const states = { invoiceStateId: jest.fn(async (c: string) => (c === InvoiceStateCode.IN_PROGRESS ? 2 : 7)) } as unknown as StateCatalog;
  const clock = { now: () => new Date('2026-10-06T10:00:00Z') } as Clock;
  const uow = { run: (fn: () => unknown) => fn() } as unknown as UnitOfWork;
  const audit = { snapshot: jest.fn().mockResolvedValue({}), record: jest.fn() } as unknown as AuditTrail;
  return { uc: new UpdateInvoiceUseCase(repo, states, clock, uow, audit), repo, audit };
}

describe('UpdateInvoiceUseCase', () => {
  it('altera todos os campos, recalcula o vencimento e volta a "Em curso"', async () => {
    const { uc, repo } = setup();
    await uc.execute(1, { ...input, refencence_number: 'FT 9', amount: '5000', time_limit: 60, currency_id: 2 });
    expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({
      referenceNumber: 'FT 9', amount: '5000.00', dueDate: '2026-10-31', timeLimitDays: 60, currencyId: 2, invoiceStateId: 2,
    }));
  });
  it('num processo sem negociação permite tudo; mudar o devedor tira-a do processo', async () => {
    const { uc, repo, audit } = setup({ inProcess: true }, { processId: 4, activeNegotiationId: null });
    await uc.execute(1, { ...input, debtor_id: 3 });
    expect(repo.detachFromProcess).toHaveBeenCalledWith(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ removedFromProcessId: 4 }) }));
  });
  it('com negociação activa só deixa mudar o número', async () => {
    const { uc, repo } = setup({ inProcess: true }, { processId: 4, activeNegotiationId: 12 });
    await uc.execute(1, { ...input, refencence_number: 'FT 2' });
    expect(repo.update).toHaveBeenCalled();
    await expect(uc.execute(1, { ...input, amount: '5000' })).rejects.toThrow(/NEG-00012/);
  });
  it('bloqueia facturas pagas', async () => {
    const { uc } = setup({ stateCode: InvoiceStateCode.PAID });
    await expect(uc.execute(1, input)).rejects.toThrow(BusinessRuleError);
  });
});
