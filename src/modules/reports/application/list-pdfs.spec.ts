import { mkdirSync, writeFileSync } from 'node:fs';
import { debtorsPdf, invoicesPdf, negotiationsPdf, paymentsPdf, processesPdf } from './list-pdfs';

const ctx = (extra: Partial<{ total: number; truncated: boolean }> = {}) => ({
  generatedBy: 'Administrador',
  filters: [['Estado', 'Vencida'], ['Vencimento', '01/07/2026 a 30/09/2026']] as Array<[string, string]>,
  total: 30, truncated: false, ...extra,
});
const save = (name: string, pdf: Buffer) => {
  expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  if (process.env.SAVE_PDF_DIR) {
    mkdirSync(process.env.SAVE_PDF_DIR, { recursive: true });
    writeFileSync(`${process.env.SAVE_PDF_DIR}/${name}.pdf`, pdf);
  }
};
const many = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe('PDF das listagens', () => {
  it('facturas', () => {
    const rows = many(120, (i) => ({
      referenceNumber: `FT 2026/${100 + i}`, amount: String(250000 + i * 13500), issueDate: '2026-05-10', dueDate: '2026-06-10', overdueDays: i % 5 === 0 ? 0 : 20 + i * 4, inProcess: i % 3 === 0,
      debtor: { name: i % 9 === 0 ? `Sociedade Comercial de Equipamentos e Serviços Técnicos Exemplo ${i + 1}, Lda` : `Devedor Exemplo ${i + 1}, Lda` }, currency: { code: 'AOA', symbol: 'Kz' }, invoiceState: { name: i % 5 === 0 ? 'Pendente' : 'Vencida' },
    }));
    save('facturas', invoicesPdf(rows, ctx({ total: 120 })));
    save('facturas-vazio', invoicesPdf([], ctx({ total: 0 })));
    save('facturas-truncado', invoicesPdf(rows, ctx({ total: 7200, truncated: true })));
  });
  it('devedores', () => {
    const rows = many(30, (i) => ({ name: `Devedor Exemplo ${i + 1}, Lda`, nif: `54170${i}2345`, isCompany: i % 4 !== 0, isActive: i % 7 !== 0, phoneNumber: `92300${i}000`, email: i % 6 === 0 ? `departamento.financeiro.contas.a.pagar${i}@grupoexemplodeangola.co.ao` : `contacto${i}@exemplo.ao`, organizationId: i % 3, organization: { name: i % 2 ? 'Banco Atlântico' : 'Unitel' }, debtorType: { name: i % 4 ? 'Empresa' : 'Particular' }, createdAt: '2026-04-01T10:00:00Z' }));
    save('devedores', debtorsPdf(rows, ctx()));
  });
  it('processos', () => {
    const rows = many(30, (i) => ({ id: i + 1, debtor: { name: `Devedor Exemplo ${i + 1}, Lda` }, invoicesCount: 1 + (i % 4), totalAmount: String(900000 + i * 21000), processState: { name: 'Em cobrança' }, assignment: i % 6 === 0 ? null : { userId: 3, user: { fullName: 'João Conceição' } }, lastContactAt: i % 5 === 0 ? null : '2026-09-20T10:00:00Z', lastContactStatus: i % 2 ? 'answered' : 'no_answer', contactsCount: i % 5 }));
    save('processos', processesPdf(rows, ctx()));
  });
  it('negociações', () => {
    const st = ['ACTIVE', 'COMPLETED', 'BROKEN', 'PENDING_APPROVAL'];
    const rows = many(30, (i) => ({ id: i + 1, status: st[i % 4], debtAmount: '1200000', totalAmount: String(1100000 - i * 5000), finalAmount: String(1100000 - i * 5000), discountRate: i % 3 ? '8.5' : '0', isInstallment: i % 2 === 0, totalInstallments: 6, startDate: '2026-07-01', endDate: '2026-12-31', processesCount: 2, debtor: { name: `Devedor Exemplo ${i + 1}, Lda`, nif: '5417012345' } }));
    save('negociacoes', negotiationsPdf(rows, ctx()));
  });
  it('pagamentos', () => {
    const st = ['CONFIRMED', 'PENDING', 'CANCELLED', 'REVERSED'];
    const rows = many(30, (i) => ({ id: `a1b2c3d4-0000-${i}`, status: st[i % 4], paidOn: '2026-09-12', negotiationId: 10 + i, debtorId: 1 + (i % 3), receiver: i % 2 ? 'AGENCY' : 'CREDITOR', paymentMethod: { name: 'Transferência' }, reference: `REF${i}8821`, registeredBy: { fullName: 'Ana Silva' }, amount: String(180000 + i * 4000), amountBase: String(180000 + i * 4000), currency: { symbol: 'Kz' } }));
    save('pagamentos', paymentsPdf(rows, { ...ctx(), debtorNames: { 1: 'Devedor Exemplo 1, Lda', 2: 'Devedor Exemplo 2, Lda', 3: 'Devedor Exemplo 3, Lda' } }));
  });
});
