import { writeFileSync } from 'node:fs';
import { PdfDocument } from './pdf-document';
import { ReportPdf } from './report-pdf';

describe('ReportPdf', () => {
  it('gera um PDF válido com acentos, tabelas e várias páginas', () => {
    const r = new ReportPdf({ title: 'Relatório de Contas a Receber', subtitle: 'Indicadores de cobrança — período de 01/09/2026 a 30/09/2026', filters: [['Credor', 'Todos'], ['Agente', 'João Conceição']], generatedBy: 'Administrador' });
    r.section('Indicadores', 'Valores na moeda base (Kz).');
    r.kpis([
      { label: 'DSO', value: '48 dias', hint: 'Prazo médio de recebimento', tone: 'brand' },
      { label: 'Inadimplência', value: '12,4%', hint: 'Vencido há mais de 90 dias', tone: 'danger' },
      { label: 'CEI', value: '76,0%', tone: 'success' },
      { label: 'Custo por cobrança', value: '4,2%', tone: 'warning' },
    ]);
    r.section('Aging');
    r.bars([{ label: 'A vencer', value: 10, valueLabel: '1 000 000,00 Kz' }, { label: '1–30 dias', value: 5, valueLabel: '500 000,00 Kz', tone: 'warning' }]);
    r.section('Detalhe');
    r.table(
      [{ header: 'Devedor', width: 3 }, { header: 'Factura', width: 2 }, { header: 'Em aberto', width: 2, align: 'right' }],
      [{ cells: ['Grupo: Credor Ação Ç'], kind: 'group' }, ...Array.from({ length: 80 }, (_, i) => ({ cells: [`Devedor nº ${i} — São Tomé`, `FT-${i}`, '1 234 567,89 Kz'] })), { cells: ['Total', '', '98 765 432,10 Kz'], kind: 'total' }],
    );
    const pdf = r.finish();
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1')).toContain('/Count 3');
    if (process.env.SAVE_PDF) writeFileSync(process.env.SAVE_PDF, pdf);
  });

  it('mede larguras com acentos iguais à letra base', () => {
    const d = new PdfDocument();
    expect(d.textWidth('ção', 10)).toBeCloseTo(d.textWidth('cao', 10));
    expect(d.fit('Texto muito comprido para caber', 40, 10).endsWith('…')).toBe(true);
  });
});
