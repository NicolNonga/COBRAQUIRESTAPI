import { PdfDocument } from './pdf-document';

/**
 * Documento de listagem: a tabela do ecrã em papel, com TODAS as linhas. Cabeçalho sóbrio, tabela a
 * preto e branco com cabeçalho repetido em cada página, linha de totais e rodapé numerado.
 * Sem cores de marca, sem gráficos e sem painéis de indicadores — isso é dos relatórios.
 */
const C = { ink: '#111111', text: '#222222', muted: '#666666', rule: '#8a8a8a', hair: '#dcdcdc', head: '#f1f1f1' };

export interface TableColumn {
  header: string;
  /** largura relativa (as colunas repartem a largura útil da página) */
  width: number;
  align?: 'left' | 'right' | 'center';
  /** mantém numa só linha, cortando com "…" (códigos, datas, números) */
  nowrap?: boolean;
}

export interface TableMeta {
  title: string;
  /** "1 234 registos" — à direita do título */
  count?: string;
  /** pares "Filtro: valor" aplicados à listagem */
  filters?: Array<[string, string]>;
  /** pares com os poucos totais que interessam, numa linha */
  summary?: Array<[string, string]>;
  generatedBy?: string;
  generatedAt?: Date;
  landscape?: boolean;
  company?: string;
}

const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' }).format(d);

export class TablePdf {
  readonly doc: PdfDocument;
  private readonly M = 30;
  private readonly bottom: number;
  private readonly meta: TableMeta & { company: string; generatedAt: Date };

  constructor(meta: TableMeta) {
    this.meta = { company: 'Cobraqui', generatedAt: new Date(), landscape: true, ...meta };
    this.doc = new PdfDocument({ landscape: this.meta.landscape, title: meta.title, author: this.meta.company });
    this.bottom = this.doc.height - 34;
    this.firstHeader();
  }

  get width() {
    return this.doc.width - this.M * 2;
  }

  private firstHeader() {
    const d = this.doc;
    const M = this.M;
    d.text(this.meta.company.toUpperCase(), M, 28, { size: 9, bold: true, color: C.muted });
    d.text(`Gerado em ${fmtDateTime(this.meta.generatedAt)}${this.meta.generatedBy ? ` · ${this.meta.generatedBy}` : ''}`, M + this.width, 28, { size: 7.5, color: C.muted, align: 'right' });
    d.text(this.meta.title, M, 52, { size: 16, bold: true, color: C.ink, maxWidth: this.width * 0.65 });
    if (this.meta.count) d.text(this.meta.count, M + this.width, 52, { size: 9.5, bold: true, color: C.text, align: 'right' });
    let y = 60;
    const lines: string[] = [];
    if (this.meta.summary?.length) lines.push(this.meta.summary.map(([k, v]) => `${k}: ${v}`).join('   ·   '));
    if (this.meta.filters?.length) lines.push(`Filtros — ${this.meta.filters.map(([k, v]) => `${k}: ${v}`).join('   ·   ')}`);
    for (const l of lines) for (const w of d.wrap(l, this.width, 7.8)) { y += 11; d.text(w, M, y, { size: 7.8, color: C.muted }); }
    d.y = y + 12;
  }

  private continuationHeader() {
    const d = this.doc;
    d.text(`${this.meta.title} (continuação)`, this.M, 24, { size: 8.5, bold: true, color: C.muted, maxWidth: this.width });
    d.y = 34;
  }

  /** parte a célula em linhas; palavras indivisíveis (emails, referências) quebram por caracteres em vez de serem cortadas */
  private cellLines(value: string, w: number, size: number): string[] {
    const d = this.doc;
    const out: string[] = [];
    for (const para of String(value ?? '').split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (d.textWidth(next, size) <= w) { line = next; continue; }
        if (line) { out.push(line); line = ''; }
        if (d.textWidth(word, size) <= w) { line = word; continue; }
        let chunk = '';
        for (const ch of word) {
          if (chunk && d.textWidth(chunk + ch, size) > w) { out.push(chunk); chunk = ch; } else chunk += ch;
        }
        line = chunk;
      }
      if (line) out.push(line);
    }
    return out.length ? out : [''];
  }

  private newPage() {
    this.doc.addPage();
    this.continuationHeader();
  }

  /** tabela paginada: cabeçalho repetido, linhas com todo o conteúdo (quebra em quantas linhas precisar) */
  table(columns: TableColumn[], rows: string[][], o: { emptyText?: string; fontSize?: number; totals?: string[] } = {}) {
    const d = this.doc;
    const size = o.fontSize ?? 7.6;
    const relative = columns.reduce((n, c) => n + c.width, 0);
    const widths = columns.map((c) => (c.width / relative) * this.width);
    const xs = widths.reduce<number[]>((acc, w, i) => [...acc, i === 0 ? this.M : acc[i - 1] + widths[i - 1]], []);
    const pad = 5;
    const lineH = size + 2.6;
    const vpad = 4.6;
    const at = (c: TableColumn, i: number) => (c.align === 'right' ? xs[i] + widths[i] - pad : c.align === 'center' ? xs[i] + widths[i] / 2 : xs[i] + pad);
    const headH = size + 11;

    const header = () => {
      d.rect(this.M, d.y, this.width, headH, { fill: C.head });
      d.line(this.M, d.y, this.M + this.width, d.y, C.ink, 0.9);
      columns.forEach((c, i) => {
        const label = c.header.toUpperCase();
        let hs = size - 0.8;
        while (hs > 4.8 && d.textWidth(label, hs, true) > widths[i] - pad * 2) hs -= 0.2;
        d.text(label, at(c, i), d.y + headH - 4.6, { size: hs, bold: true, color: C.ink, align: c.align, maxWidth: widths[i] - pad * 2 });
      });
      d.y += headH;
      d.line(this.M, d.y, this.M + this.width, d.y, C.rule, 0.6);
    };

    if (d.y + headH + lineH * 3 > this.bottom) this.newPage();
    header();

    if (!rows.length) {
      const h = vpad * 2 + size + 12;
      d.text(o.emptyText ?? 'Sem registos para os filtros escolhidos.', this.M + this.width / 2, d.y + h / 2 + size / 2, { size: size + 0.6, color: C.muted, align: 'center' });
      d.y += h;
      d.line(this.M, d.y, this.M + this.width, d.y, C.ink, 0.8);
      d.y += 12;
      return;
    }

    for (const r of rows) {
      const cells = columns.map((c, i) => {
        const v = r[i] ?? '';
        return c.nowrap ? [d.fit(v, widths[i] - pad * 2, size)] : this.cellLines(v, widths[i] - pad * 2, size);
      });
      const count = Math.max(1, ...cells.map((w) => w.length));
      const h = vpad * 2 + size + (count - 1) * lineH;
      if (d.y + h > this.bottom) { this.newPage(); header(); }
      columns.forEach((c, i) => {
        cells[i].forEach((l, k) => d.text(l, at(c, i), d.y + vpad + size + k * lineH, { size, color: C.text, align: c.align }));
      });
      d.y += h;
      d.line(this.M, d.y, this.M + this.width, d.y, C.hair, 0.4);
    }

    if (o.totals) {
      const h = vpad * 2 + size;
      if (d.y + h + 2 > this.bottom) { this.newPage(); header(); }
      d.line(this.M, d.y, this.M + this.width, d.y, C.ink, 0.9);
      columns.forEach((c, i) => {
        const v = o.totals![i];
        if (v) d.text(v, at(c, i), d.y + vpad + size, { size, bold: true, color: C.ink, align: c.align, maxWidth: widths[i] - pad * 2 });
      });
      d.y += h;
    }
    d.line(this.M, d.y, this.M + this.width, d.y, C.ink, 0.8);
    d.y += 12;
  }

  /** nota em letra pequena sob a tabela (moedas diferentes, limite de linhas) */
  note(text: string) {
    const d = this.doc;
    for (const l of d.wrap(text, this.width, 7.2)) {
      if (d.y + 11 > this.bottom) this.newPage();
      d.y += 10;
      d.text(l, this.M, d.y, { size: 7.2, color: C.muted });
    }
    d.y += 6;
  }

  /** rodapé com origem do documento e "Página x de y"; devolve o PDF */
  finish(): Buffer {
    const d = this.doc;
    const n = d.pageCount;
    const stamp = fmtDateTime(this.meta.generatedAt);
    for (let i = 0; i < n; i++) {
      d.onPage(i, () => {
        const y = d.height - 18;
        d.line(this.M, y - 10, this.M + this.width, y - 10, C.hair, 0.6);
        d.text(`${this.meta.company} · ${this.meta.title} · ${stamp}`, this.M, y, { size: 7, color: C.muted, maxWidth: this.width * 0.6 });
        d.text(`Página ${i + 1} de ${n}`, this.M + this.width, y, { size: 7, color: C.muted, align: 'right' });
      });
    }
    return d.toBuffer();
  }
}
