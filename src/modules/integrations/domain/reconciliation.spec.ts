import { ExternalInvoice } from './canonical';
import { decide, LocalInvoice, processClosure } from './reconciliation';

const local = (over: Partial<LocalInvoice> = {}): LocalInvoice => ({
  invoiceId: 1, reference: 'FT 2026/100', state: 'OVERDUE', amount: '1000.00', processId: 10, agreementActive: false,
  lastSeen: { status: 'OPEN', amount: '1000.00', openAmount: '1000.00' }, ...over,
});
const ext = (over: Partial<ExternalInvoice> = {}): ExternalInvoice => ({
  externalId: '1000/2026/90000001/1', companyCode: '1000', customerExternalId: 'C1', reference: 'FT 2026/100', issueDate: '2026-05-01',
  dueDate: '2026-06-01', amount: '1000.00', openAmount: '1000.00', currency: 'AOA', status: 'OPEN', changedAt: null, ...over,
});

describe('reconciliação', () => {
  it('paga no ERP, em processo sem acordo → liquida', () => {
    expect(decide(local(), ext({ status: 'CLEARED', openAmount: '0.00' }))).toEqual({ action: 'MARK_PAID' });
  });

  it('paga no ERP com acordo activo → revisão, nunca fecha sozinha', () => {
    const d = decide(local({ agreementActive: true }), ext({ status: 'CLEARED', openAmount: '0.00' }));
    expect(d).toMatchObject({ action: 'REVIEW', kind: 'PAID_WITH_AGREEMENT' });
  });

  it('anulada no ERP → cancela; com acordo → revisão', () => {
    expect(decide(local(), ext({ status: 'CANCELLED' }))).toEqual({ action: 'MARK_CANCELLED' });
    expect(decide(local({ agreementActive: true }), ext({ status: 'CANCELLED' }))).toMatchObject({ kind: 'CANCELLED_WITH_AGREEMENT' });
  });

  it('pagamento parcial → regista o valor em aberto; com acordo → revisão', () => {
    expect(decide(local(), ext({ status: 'PARTIAL', openAmount: '400.00' }))).toEqual({ action: 'RECORD_PARTIAL', openAmount: '400.00' });
    expect(decide(local({ agreementActive: true }), ext({ status: 'PARTIAL', openAmount: '400.00' }))).toMatchObject({ kind: 'PARTIAL_WITH_AGREEMENT' });
  });

  it('valor alterado no ERP → actualiza; com acordo → revisão', () => {
    expect(decide(local(), ext({ amount: '1200.00', openAmount: '1200.00' }))).toEqual({ action: 'UPDATE_AMOUNT', amount: '1200.00' });
    expect(decide(local({ agreementActive: true }), ext({ amount: '1200.00', openAmount: '1200.00' }))).toMatchObject({ kind: 'AMOUNT_CHANGED_WITH_AGREEMENT' });
  });

  it('nada mudou desde a última leitura → nada a fazer (revisão ignorada não reabre)', () => {
    const seen = { status: 'CLEARED' as const, amount: '1000.00', openAmount: '0.00' };
    expect(decide(local({ agreementActive: true, lastSeen: seen }), ext({ status: 'CLEARED', openAmount: '0.00' }))).toEqual({ action: 'NONE' });
  });

  it('liquidada pelo ERP e depois reaberta no ERP → revisão de estorno', () => {
    const d = decide(local({ state: 'PAID', lastSeen: { status: 'CLEARED', amount: '1000.00', openAmount: '0.00' } }), ext());
    expect(d).toMatchObject({ action: 'REVIEW', kind: 'PAYMENT_REVERSED' });
  });

  it('liquidada no Cobraqui por um acordo (não pelo ERP) e ainda aberta no ERP → não mexe', () => {
    expect(decide(local({ state: 'PAID', lastSeen: { status: 'OPEN', amount: null, openAmount: null } }), ext())).toEqual({ action: 'NONE' });
  });

  it('em disputa e paga no ERP → revisão para encerrar a disputa', () => {
    expect(decide(local({ state: 'IN_DISPUTE', processId: null }), ext({ status: 'CLEARED', openAmount: '0.00' }))).toMatchObject({ kind: 'PAID_IN_DISPUTE' });
  });

  it('deixou de existir no ERP → revisão (nunca se apaga nada sozinho)', () => {
    expect(decide(local(), null)).toMatchObject({ kind: 'MISSING_IN_ERP' });
    expect(decide(local({ state: 'PAID' }), null)).toEqual({ action: 'NONE' });
  });

  it('ligação nova (estado base OPEN, sem valores) a uma factura já paga no ERP → liquida', () => {
    const d = decide(local({ lastSeen: { status: 'OPEN', amount: null, openAmount: null } }), ext({ status: 'CLEARED', openAmount: '0.00' }));
    expect(d).toEqual({ action: 'MARK_PAID' });
  });

  it('fecho do processo', () => {
    expect(processClosure({ allSettled: true, agreementActive: false, autoClose: true })).toBe('CLOSE');
    expect(processClosure({ allSettled: true, agreementActive: false, autoClose: false })).toBe('REVIEW');
    expect(processClosure({ allSettled: false, agreementActive: false, autoClose: true })).toBe('KEEP_OPEN');
    expect(processClosure({ allSettled: true, agreementActive: true, autoClose: true })).toBe('KEEP_OPEN');
  });
});
