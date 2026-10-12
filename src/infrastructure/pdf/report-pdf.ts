import { PdfDocument } from './pdf-document';

/** Paleta do Cobraqui para documentos. */
export const COLORS = {
  ink: '#101828', text: '#344054', muted: '#667085', faint: '#98a2b3', border: '#e4e7ec', line: '#eef0f3', subtle: '#f8fafc', zebra: '#f9fafb',
  navy: '#0b2a4a', navy2: '#14406b', navySoft: '#e8eef6', navyLine: '#2b4d73',
  brand: '#1580d8', brandDark: '#0f5fa3', brandSoft: '#eef7fe', accent: '#22b8cf',
  success: '#079455', successSoft: '#ecfdf3', warning: '#dc6803', warningSoft: '#fffaeb', danger: '#d92d20', dangerSoft: '#fef3f2',
  // faixas (verde → vermelho escuro)
  g0: '#12b76a', g1: '#f5b50c', g2: '#f79009', g3: '#ee6a1c', g4: '#d92d20', g5: '#912018',
  // série para gráficos de categorias
  series: ['#1580d8', '#12b76a', '#f79009', '#7a5af8', '#d92d20', '#22b8cf', '#98a2b3'],
};
const C = COLORS;

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
const TONE: Record<Tone, { fg: string; bg: string; edge: string; light: string; word: string }> = {
  neutral: { fg: C.ink, bg: C.subtle, edge: C.border, light: '#a9c1db', word: '' },
  brand: { fg: C.brandDark, bg: C.brandSoft, edge: '#b2ddff', light: '#84caff', word: '' },
  success: { fg: C.success, bg: C.successSoft, edge: '#abefc6', light: '#6ce9a6', word: 'BOM' },
  warning: { fg: C.warning, bg: C.warningSoft, edge: '#fedf89', light: '#fec84b', word: 'ATENÇÃO' },
  danger: { fg: C.danger, bg: C.dangerSoft, edge: '#fecdca', light: '#fda29b', word: 'CRÍTICO' },
};

export interface ReportMeta {
  title: string;
  subtitle?: string;
  /** pares "Filtro: valor" mostrados abaixo do cabeçalho */
  filters?: Array<[string, string]>;
  generatedBy?: string;
  generatedAt?: Date;
  landscape?: boolean;
  company?: string;
  /** etiqueta no canto do cabeçalho */
  tag?: string;
}

export interface Column {
  header: string;
  /** largura relativa (as colunas repartem a largura útil) */
  width: number;
  align?: 'left' | 'right' | 'center';
  /** texto longo: quebra em até 3 linhas em vez de cortar */
  wrap?: boolean;
}
export interface Row {
  cells: string[];
  kind?: 'normal' | 'group' | 'subtotal' | 'total';
  /** destaca uma célula (índice) com uma cor */
  tones?: Record<number, Tone>;
}
/** Régua de desempenho: onde o valor cai entre "bom", "atenção" e "crítico". */
export interface Gauge {
  value: number;
  good: number;
  bad: number;
  max: number;
  higherIsBetter?: boolean;
}
export interface KpiCard {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  /** mostra o selo Bom / Atenção / Crítico (só em indicadores com meta) */
  status?: boolean;
  /** texto da meta, p.ex. "Meta até 45 dias" */
  target?: string;
  gauge?: Gauge;
}
export interface HeroItem {
  label: string;
  value: string;
  sub?: string;
  subTone?: Tone;
}
export interface Insight {
  tone: Tone;
  title: string;
  text: string;
}
export interface Slice {
  label: string;
  value: number;
  valueLabel: string;
  /** texto secundário (ex.: n.º de facturas) */
  sub?: string;
  color: string;
}

const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' }).format(d);

const niceMax = (max: number) => {
  if (max <= 0) return 4;
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s * 4 >= max) ?? 10 * mag;
  return step * 4;
};

/** Relatório executivo paginado: cabeçalho de marca, resumo com números, veredicto, gráficos, destaques e tabelas. */
export class ReportPdf {
  readonly doc: PdfDocument;
  private readonly M = 36;
  private readonly bottom: number;
  private readonly meta: ReportMeta;

  constructor(meta: ReportMeta) {
    this.meta = { generatedAt: new Date(), company: 'Cobraqui', tag: 'RELATÓRIO DE COBRANÇA', ...meta };
    this.doc = new PdfDocument({ landscape: meta.landscape, title: meta.title, author: this.meta.company });
    this.bottom = this.doc.height - 46;
    this.firstHeader();
  }

  get width() {
    return this.doc.width - this.M * 2;
  }
  get x() {
    return this.M;
  }

  /** marca: quadrado azul com barras ascendentes */
  private mark(x: number, y: number, s: number) {
    const d = this.doc;
    d.rect(x, y, s, s, { fill: C.brand, radius: s * 0.24 });
    const bw = s * 0.16;
    const gap = s * 0.09;
    const x0 = x + (s - (bw * 3 + gap * 2)) / 2;
    const base = y + s * 0.8;
    [0.3, 0.5, 0.72].forEach((hh, i) => d.rect(x0 + i * (bw + gap), base - s * hh, bw, s * hh, { fill: '#ffffff', radius: bw * 0.25 }));
  }

  private firstHeader() {
    const d = this.doc;
    const M = this.M;
    const sub = this.meta.subtitle ? d.wrap(this.meta.subtitle, this.width * 0.95, 9.5) : [];
    const h = (sub.length ? 98 + (sub.length - 1) * 13 : 80) + 22;
    d.gradientH(0, 0, d.width, h, C.navy, C.navy2, 48);
    d.rect(0, h, d.width, 3, { fill: C.accent });
    this.mark(M, 20, 24);
    d.text('COBRAQUI', M + 33, 37, { size: 12.5, bold: true, color: '#ffffff' });
    d.text(this.meta.tag!, d.width - M, 29, { size: 7.5, bold: true, color: '#8fb2d6', align: 'right' });
    d.text(`Gerado em ${fmtDateTime(this.meta.generatedAt!)}${this.meta.generatedBy ? ` · ${this.meta.generatedBy}` : ''}`, d.width - M, 40, { size: 7.5, color: '#9cb3cc', align: 'right' });
    d.text(this.meta.title, M, 80, { size: 23, bold: true, color: '#ffffff', maxWidth: this.width });
    sub.forEach((l, i) => d.text(l, M, 98 + i * 13, { size: 9.5, color: '#c3d4e8' }));

    let y = h + 3 + 14;
    const filters = this.meta.filters ?? [];
    if (filters.length) {
      let x = M;
      for (const [k, v] of filters) {
        const label = `${k}: `;
        const w = d.textWidth(label, 8, true) + d.textWidth(v, 8) + 16;
        if (x + w > M + this.width) { x = M; y += 21; }
        d.rect(x, y, w, 16, { fill: C.brandSoft, stroke: '#b2ddff', radius: 8 });
        d.text(label, x + 8, y + 11, { size: 8, bold: true, color: C.brandDark });
        d.text(v, x + 8 + d.textWidth(label, 8, true), y + 11, { size: 8, color: C.text });
        x += w + 6;
      }
      y += 16 + 12;
    }
    d.y = y + 6;
  }

  private continuationHeader() {
    const d = this.doc;
    d.gradientH(0, 0, d.width, 28, C.navy, C.navy2, 32);
    d.rect(0, 28, d.width, 2, { fill: C.accent });
    this.mark(this.M, 7, 14);
    d.text(this.meta.title, this.M + 22, 18.5, { size: 8.5, bold: true, color: '#ffffff', maxWidth: this.width * 0.7 });
    d.text(this.meta.company!.toUpperCase(), d.width - this.M, 18.5, { size: 7.5, bold: true, color: '#8fb2d6', align: 'right' });
    d.y = 50;
  }

  newPage() {
    this.doc.addPage();
    this.continuationHeader();
  }

  /** garante espaço vertical; caso contrário, nova página */
  ensure(h: number): boolean {
    if (this.doc.y + h <= this.bottom) return false;
    this.newPage();
    return true;
  }

  space(h = 10) {
    this.doc.y += h;
  }

  /** `need` = altura mínima que o conteúdo seguinte exige: evita título isolado no fim da página */
  section(title: string, description?: string, need = 0) {
    const d = this.doc;
    this.ensure(Math.max(description ? 70 : 52, need));
    d.y += 12;
    d.rect(this.M, d.y - 12, 4, 16, { fill: C.brand, radius: 2 });
    d.text(title, this.M + 12, d.y, { size: 13, bold: true, color: C.navy });
    d.y += 8;
    d.line(this.M, d.y, this.M + this.width, d.y, C.border, 0.8);
    if (description) {
      d.y += 3;
      for (const l of d.wrap(description, this.width, 8.5)) { d.y += 12; d.text(l, this.M, d.y, { size: 8.5, color: C.muted }); }
    }
    d.y += 14;
  }

  paragraph(text: string, o: { size?: number; color?: string; bold?: boolean } = {}) {
    const d = this.doc;
    const size = o.size ?? 9;
    for (const l of d.wrap(text, this.width, size, o.bold)) {
      this.ensure(size + 4);
      d.y += size + 3;
      d.text(l, this.M, d.y, { size, color: o.color ?? C.text, bold: o.bold });
    }
    d.y += 6;
  }

  /** painel escuro com os números que contam — a primeira coisa que o decisor lê */
  hero(items: HeroItem[]) {
    const d = this.doc;
    const w = this.width / items.length;
    const inner = w - 30;
    let size = 21;
    while (size > 11 && items.some((i) => d.textWidth(i.value, size, true) > inner)) size -= 0.5;
    const labels = items.map((i) => d.wrap(i.label.toUpperCase(), inner, 6.8, true).slice(0, 2));
    const ll = Math.max(...labels.map((l) => l.length));
    const subs = items.map((i) => (i.sub ? d.wrap(i.sub, inner, 7.5).slice(0, 2) : []));
    const sl = Math.max(0, ...subs.map((s) => s.length));
    const h = 18 + ll * 9 + size + 8 + (sl ? 6 + sl * 10 : 0) + 14;
    this.ensure(h + 14);
    d.rect(this.M, d.y, this.width, h, { fill: C.navy, radius: 8 });
    d.rect(this.M + 14, d.y, 34, 3, { fill: C.accent, radius: 1.5 });
    items.forEach((it, i) => {
      const x = this.M + i * w + 15;
      if (i > 0) d.line(this.M + i * w, d.y + 16, this.M + i * w, d.y + h - 16, C.navyLine, 0.6);
      labels[i].forEach((l, k) => d.text(l, x, d.y + 22 + k * 9, { size: 6.8, bold: true, color: '#8fb2d6' }));
      const vy = d.y + 22 + (ll - 1) * 9 + 6 + size;
      d.text(it.value, x, vy, { size, bold: true, color: '#ffffff' });
      subs[i].forEach((l, k) => d.text(l, x, vy + 14 + k * 10, { size: 7.5, color: TONE[it.subTone ?? 'neutral'].light }));
    });
    d.y += h + 16;
  }

  private glyph(cx: number, cy: number, tone: Tone) {
    const d = this.doc;
    const w = '#ffffff';
    if (tone === 'success') {
      d.line(cx - 5.5, cy + 0.5, cx - 1.8, cy + 4.2, w, 2.2);
      d.line(cx - 1.8, cy + 4.2, cx + 5.5, cy - 4, w, 2.2);
    } else if (tone === 'danger') {
      d.line(cx - 4.5, cy - 4.5, cx + 4.5, cy + 4.5, w, 2.2);
      d.line(cx - 4.5, cy + 4.5, cx + 4.5, cy - 4.5, w, 2.2);
    } else if (tone === 'warning') {
      d.rect(cx - 1.1, cy - 6.5, 2.2, 8.5, { fill: w, radius: 1 });
      d.circle(cx, cy + 5, 1.4, { fill: w });
    } else {
      d.circle(cx, cy - 5.2, 1.4, { fill: w });
      d.rect(cx - 1.1, cy - 2.2, 2.2, 8.4, { fill: w, radius: 1 });
    }
  }

  /** veredicto em destaque: cor, ícone, conclusão em uma frase */
  verdict(tone: Tone, title: string, text: string) {
    const d = this.doc;
    const t = TONE[tone];
    const left = 62;
    const lines = d.wrap(text, this.width - left - 16, 9);
    const h = Math.max(56, 26 + lines.length * 12 + 12);
    this.ensure(h + 14);
    d.rect(this.M, d.y, this.width, h, { fill: t.bg, stroke: t.edge, radius: 8 });
    d.rect(this.M, d.y + 8, 4, h - 16, { fill: t.fg, radius: 2 });
    d.circle(this.M + 32, d.y + h / 2, 15, { fill: t.fg });
    this.glyph(this.M + 32, d.y + h / 2, tone);
    d.text(title, this.M + left, d.y + 22, { size: 11.5, bold: true, color: t.fg, maxWidth: this.width - left - 16 });
    lines.forEach((l, i) => d.text(l, this.M + left, d.y + 37 + i * 12, { size: 9, color: C.text }));
    d.y += h + 16;
  }

  /** cartões de indicador: rótulo, valor grande, selo de estado, meta, régua e nota */
  kpis(cards: KpiCard[], perRow = 4) {
    const d = this.doc;
    const gap = 10;
    const w = (this.width - gap * (perRow - 1)) / perRow;
    const inner = w - 22;
    for (let i = 0; i < cards.length; i += perRow) {
      const row = cards.slice(i, i + perRow);
      const labels = row.map((c) => d.wrap(c.label.toUpperCase(), inner, 6.8, true).slice(0, 2));
      const ll = Math.max(...labels.map((l) => l.length));
      const hints = row.map((c) => (c.hint ? d.wrap(c.hint, inner, 7.5).slice(0, 3) : []));
      const hl = Math.max(0, ...hints.map((l) => l.length));
      let size = 18;
      while (size > 9 && row.some((c) => d.textWidth(c.value, size, true) > inner)) size -= 0.5;
      const hasRow = row.some((c) => (c.status && c.tone && TONE[c.tone].word) || c.target);
      const hasGauge = row.some((c) => c.gauge);
      const vy = 24 + (ll - 1) * 9 + 6 + size;
      let off = vy;
      const rowY = off + 9;
      if (hasRow) off += 9 + 13;
      const gaugeY = off + 8;
      if (hasGauge) off += 8 + 6;
      const hintY = off + 14;
      const h = hl ? hintY + (hl - 1) * 9.5 + 10 : off + 12;
      this.ensure(h + gap);
      row.forEach((c, j) => {
        const x = this.M + j * (w + gap);
        const t = TONE[c.tone ?? 'neutral'];
        const top = d.y;
        d.rect(x, top, w, h, { fill: '#ffffff', stroke: C.border, radius: 6 });
        d.rect(x + 11, top, 26, 3, { fill: c.tone && c.tone !== 'neutral' ? t.fg : C.brand, radius: 1.5 });
        labels[j].forEach((l, k) => d.text(l, x + 11, top + 17 + k * 9, { size: 6.8, bold: true, color: C.muted }));
        d.text(c.value, x + 11, top + vy, { size, bold: true, color: c.tone && c.tone !== 'neutral' && c.status ? t.fg : C.ink });
        if (c.status && c.tone && t.word) {
          const pw = d.textWidth(t.word, 6.3, true) + 12;
          d.rect(x + 11, top + rowY, pw, 12, { fill: t.bg, stroke: t.edge, radius: 6 });
          d.text(t.word, x + 11 + pw / 2, top + rowY + 8.6, { size: 6.3, bold: true, color: t.fg, align: 'center' });
        }
        if (c.target) d.text(c.target, x + w - 11, top + rowY + 9, { size: 7, color: C.muted, align: 'right', maxWidth: inner - (c.status && c.tone && t.word ? 52 : 0) });
        if (c.gauge) this.gauge(x + 11, top + gaugeY, inner, c.gauge);
        hints[j].forEach((l, k) => d.text(l, x + 11, top + hintY + k * 9.5, { size: 7.5, color: C.muted }));
      });
      d.y += h + gap;
    }
    d.y += 6;
  }

  /** régua com três zonas (bom / atenção / crítico) e marcador do valor actual */
  private gauge(x: number, y: number, w: number, g: Gauge) {
    const d = this.doc;
    const pos = (v: number) => x + Math.max(0, Math.min(1, v / g.max)) * w;
    const [c1, c2, c3] = g.higherIsBetter ? ['#fda29b', '#fec84b', '#6ce9a6'] : ['#6ce9a6', '#fec84b', '#fda29b'];
    const [b1, b2] = g.higherIsBetter ? [g.bad, g.good] : [g.good, g.bad];
    d.rect(x, y, pos(b1) - x, 5, { fill: c1, radius: 2.5 });
    d.rect(pos(b1), y, pos(b2) - pos(b1), 5, { fill: c2 });
    d.rect(pos(b2), y, x + w - pos(b2), 5, { fill: c3, radius: 2.5 });
    d.rect(x + 3, y, 3, 5, { fill: c1 });
    d.rect(x + w - 6, y, 3, 5, { fill: c3 });
    d.circle(pos(g.value), y + 2.5, 4.2, { fill: '#ffffff', stroke: C.ink, lineWidth: 1.4 });
  }

  /** barra única empilhada (ex.: aging) + legenda em tabela */
  stackedBar(items: Slice[], o: { totalLabel?: string; countHeader?: string } = {}) {
    const d = this.doc;
    const total = items.reduce((s, i) => s + i.value, 0);
    this.ensure(30 + items.length * 17 + 20);
    const y0 = d.y;
    const bh = 26;
    d.rect(this.M, y0, this.width, bh, { fill: C.subtle, radius: 5 });
    let x = this.M;
    const live = items.filter((i) => i.value > 0);
    live.forEach((i, k) => {
      const sw = total ? (i.value / total) * this.width : 0;
      const first = k === 0;
      const last = k === live.length - 1;
      if (first) d.rect(x, y0, Math.min(sw, 8), bh, { fill: i.color, radius: 5 });
      if (last) d.rect(x + sw - Math.min(sw, 8), y0, Math.min(sw, 8), bh, { fill: i.color, radius: 5 });
      d.rect(x + (first ? 4 : 0), y0, Math.max(0, sw - (first ? 4 : 0) - (last ? 4 : 0)) - (last ? 0 : 1.2), bh, { fill: i.color });
      const pct = total ? (i.value / total) * 100 : 0;
      if (sw > 30) d.text(`${pct.toFixed(pct >= 10 ? 0 : 1).replace('.', ',')}%`, x + sw / 2, y0 + 16.5, { size: 8, bold: true, color: '#ffffff', align: 'center' });
      x += sw;
    });
    d.y = y0 + bh + 14;
    // legenda
    const W = this.width;
    const cols = { label: this.M + 16, count: this.M + W * 0.52, amount: this.M + W * 0.8, pct: this.M + W };
    d.text('FAIXA DE ATRASO', cols.label, d.y, { size: 6.5, bold: true, color: C.faint });
    d.text((o.countHeader ?? 'FACTURAS').toUpperCase(), cols.count, d.y, { size: 6.5, bold: true, color: C.faint, align: 'right' });
    d.text('VALOR EM ABERTO', cols.amount, d.y, { size: 6.5, bold: true, color: C.faint, align: 'right' });
    d.text('% DO TOTAL', cols.pct, d.y, { size: 6.5, bold: true, color: C.faint, align: 'right' });
    d.y += 5;
    d.line(this.M, d.y, this.M + W, d.y, C.border, 0.6);
    items.forEach((i) => {
      d.y += 15;
      d.rect(this.M, d.y - 7.5, 8, 8, { fill: i.color, radius: 2 });
      d.text(i.label, cols.label, d.y, { size: 8.5, color: C.ink });
      d.text(i.sub ?? '', cols.count, d.y, { size: 8.5, color: C.muted, align: 'right' });
      d.text(i.valueLabel, cols.amount, d.y, { size: 8.5, bold: true, color: C.ink, align: 'right' });
      d.text(`${(total ? (i.value / total) * 100 : 0).toFixed(1).replace('.', ',')}%`, cols.pct, d.y, { size: 8.5, color: C.text, align: 'right' });
      d.line(this.M, d.y + 5, this.M + W, d.y + 5, C.line, 0.4);
    });
    d.y += 18;
  }

  /** colunas agrupadas (ex.: facturado vs recuperado por mês) */
  columnChart(categories: string[], series: Array<{ name: string; color: string; values: number[] }>, o: { height?: number; format: (v: number) => string; unit?: string }) {
    const d = this.doc;
    const H = o.height ?? 150;
    this.ensure(H + 50);
    // legenda
    let lx = this.M;
    series.forEach((s) => {
      d.rect(lx, d.y - 7, 8, 8, { fill: s.color, radius: 2 });
      d.text(s.name, lx + 12, d.y, { size: 8, color: C.text });
      lx += 12 + d.textWidth(s.name, 8) + 16;
    });
    if (o.unit) d.text(o.unit, this.M + this.width, d.y, { size: 7.5, color: C.faint, align: 'right' });
    d.y += 12;
    const axisW = 44;
    const px = this.M + axisW;
    const pw = this.width - axisW;
    const top = d.y + 8;
    const ph = H - 24;
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
    for (let g = 0; g <= 4; g++) {
      const gy = top + ph - (g / 4) * ph;
      d.line(px, gy, px + pw, gy, g === 0 ? C.faint : C.line, g === 0 ? 0.8 : 0.5);
      d.text(o.format((max / 4) * g), px - 6, gy + 2.6, { size: 6.8, color: C.faint, align: 'right' });
    }
    const n = categories.length;
    const gw = pw / Math.max(1, n);
    const bw = Math.min(30, (gw * 0.72) / series.length);
    categories.forEach((cat, ci) => {
      const gx = px + ci * gw + (gw - bw * series.length - (series.length - 1) * 3) / 2;
      series.forEach((s, si) => {
        const v = s.values[ci] ?? 0;
        const bh = (v / max) * ph;
        const bx = gx + si * (bw + 3);
        if (bh > 0.4) d.rect(bx, top + ph - bh, bw, bh, { fill: s.color, radius: Math.min(2.5, bw / 3) });
        if (gw >= 52 && v > 0) d.text(o.format(v), bx + bw / 2, top + ph - bh - 3.5, { size: 6.5, bold: true, color: C.text, align: 'center' });
      });
      d.text(cat, px + ci * gw + gw / 2, top + ph + 12, { size: 7, color: C.muted, align: 'center', maxWidth: gw - 2 });
    });
    d.y = top + ph + 26;
  }

  /** anel de proporções com total ao centro e legenda de valores */
  donut(items: Slice[], o: { centerValue: string; centerLabel: string; title?: string; valueTitle?: string }) {
    const d = this.doc;
    const R = 54;
    const r = 35;
    const live = items.filter((i) => i.value > 0);
    const h = Math.max(R * 2 + 10, items.length * 17 + 24);
    this.ensure(h + 12);
    const cx = this.M + R + 8;
    const cy = d.y + h / 2;
    const total = live.reduce((s, i) => s + i.value, 0);
    if (!total) {
      d.circle(cx, cy, R, { fill: C.subtle });
      d.circle(cx, cy, r, { fill: '#ffffff' });
    } else if (live.length === 1) {
      d.ringSector(cx, cy, R, r, 0, 359.9, live[0].color);
    } else {
      let a = 0;
      live.forEach((i) => {
        const span = (i.value / total) * 360;
        d.ringSector(cx, cy, R, r, a + 0.7, a + span - 0.7, i.color);
        a += span;
      });
    }
    d.text(o.centerValue, cx, cy + 3, { size: 15, bold: true, color: C.ink, align: 'center', maxWidth: r * 1.8 });
    d.text(o.centerLabel.toUpperCase(), cx, cy + 14, { size: 6, bold: true, color: C.muted, align: 'center', maxWidth: r * 1.8 });
    const lx = this.M + R * 2 + 44;
    const lw = this.width - (lx - this.M);
    let y = d.y + (h - (items.length * 17 + 12)) / 2 + 12;
    d.text(o.title ?? 'RESULTADO', lx + 14, y, { size: 6.5, bold: true, color: C.faint });
    d.text(o.valueTitle ?? 'N.º / VALOR', lx + lw * 0.78, y, { size: 6.5, bold: true, color: C.faint, align: 'right' });
    d.text('%', lx + lw, y, { size: 6.5, bold: true, color: C.faint, align: 'right' });
    items.forEach((i) => {
      y += 17;
      d.rect(lx, y - 7.5, 8, 8, { fill: i.color, radius: 2 });
      d.text(i.label, lx + 14, y, { size: 8.5, color: C.ink, maxWidth: lw * 0.55 });
      d.text(i.valueLabel, lx + lw * 0.78, y, { size: 8.5, bold: true, color: C.ink, align: 'right' });
      d.text(`${(total ? (i.value / total) * 100 : 0).toFixed(1).replace('.', ',')}%`, lx + lw, y, { size: 8.5, color: C.text, align: 'right' });
      d.line(lx, y + 5, lx + lw, y + 5, C.line, 0.4);
    });
    d.y += h + 12;
  }

  /** destaques e recomendações: o que os números querem dizer e o que fazer */
  insights(items: Insight[]) {
    const d = this.doc;
    const left = 40;
    for (const it of items) {
      const t = TONE[it.tone];
      const lines = d.wrap(it.text, this.width - left - 14, 8.6);
      const h = 14 + 13 + lines.length * 11.5 + 8;
      this.ensure(h + 8);
      d.rect(this.M, d.y, this.width, h, { fill: '#ffffff', stroke: C.border, radius: 6 });
      d.rect(this.M, d.y + 7, 3.5, h - 14, { fill: t.fg, radius: 1.75 });
      d.circle(this.M + 22, d.y + 20, 9.5, { fill: t.fg });
      this.glyph(this.M + 22, d.y + 20, it.tone);
      d.text(it.title, this.M + left, d.y + 19, { size: 9.5, bold: true, color: C.ink, maxWidth: this.width - left - 14 });
      lines.forEach((l, i) => d.text(l, this.M + left, d.y + 33 + i * 11.5, { size: 8.6, color: C.text }));
      d.y += h + 8;
    }
    d.y += 6;
  }

  /** barras horizontais (comparação simples) */
  bars(items: Array<{ label: string; value: number; valueLabel: string; sub?: string; tone?: Tone; color?: string }>) {
    const d = this.doc;
    const max = Math.max(1, ...items.map((i) => i.value));
    const labelW = 120;
    const valueW = 150;
    const barW = this.width - labelW - valueW - 10;
    for (const it of items) {
      this.ensure(22);
      const color = it.color ?? TONE[it.tone ?? 'brand'].fg;
      d.text(it.label, this.M, d.y + 11, { size: 8.5, color: C.text, maxWidth: labelW - 6 });
      d.rect(this.M + labelW, d.y + 3, barW, 10, { fill: C.subtle, radius: 3 });
      if (it.value > 0) d.rect(this.M + labelW, d.y + 3, Math.max(3, (it.value / max) * barW), 10, { fill: color, radius: 3 });
      d.text(it.valueLabel, this.M + this.width, d.y + 11, { size: 8.5, bold: true, color: C.ink, align: 'right' });
      if (it.sub) d.text(it.sub, this.M + this.width - d.textWidth(it.valueLabel, 8.5, true) - 8, d.y + 11, { size: 7.5, color: C.muted, align: 'right' });
      d.y += 20;
    }
    d.y += 6;
  }

  /** tabela paginada: cabeçalho escuro repetido, zebra, grupos, subtotais e totais */
  table(columns: Column[], rows: Row[], o: { emptyText?: string; fontSize?: number } = {}) {
    const d = this.doc;
    const size = o.fontSize ?? 8;
    const total = columns.reduce((n, c) => n + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const xs = widths.reduce<number[]>((acc, w, i) => [...acc, i === 0 ? this.M : acc[i - 1] + widths[i - 1]], []);
    const rowH = size + 9;
    const headH = rowH + 4;
    const pad = 6;
    const tx = (c: Column, i: number) => (c.align === 'right' ? xs[i] + widths[i] - pad : c.align === 'center' ? xs[i] + widths[i] / 2 : xs[i] + pad);

    const header = () => {
      d.rect(this.M, d.y, this.width, headH, { fill: C.navy, radius: 3 });
      columns.forEach((c, i) => {
        const label = c.header.toUpperCase();
        let hs = Math.min(6.8, size - 0.8);
        while (hs > 5 && d.textWidth(label, hs, true) > widths[i] - pad * 2) hs -= 0.2;
        d.text(label, tx(c, i), d.y + headH / 2 + 2.3, { size: hs, bold: true, color: '#ffffff', align: c.align, maxWidth: widths[i] - pad * 2 });
      });
      d.y += headH;
    };

    this.ensure(headH + rowH * 3);
    header();
    if (!rows.length) {
      d.rect(this.M, d.y, this.width, rowH * 2.2, { fill: C.subtle });
      d.text(o.emptyText ?? 'Sem dados para o período e filtros escolhidos.', this.M + this.width / 2, d.y + rowH * 1.3, { size: size + 0.5, color: C.muted, align: 'center' });
      d.y += rowH * 2.2 + 12;
      return;
    }
    const lineH = size + 2.5;
    let zebra = 0;
    rows.forEach((r) => {
      const kind = r.kind ?? 'normal';
      const wrapped = columns.map((c, i) => (c.wrap && kind === 'normal' ? d.wrap(r.cells[i] ?? '', widths[i] - pad * 2, size).slice(0, 3) : null));
      const lines = Math.max(1, ...wrapped.map((w) => w?.length ?? 1));
      const h = rowH + (lines - 1) * lineH;
      if (this.ensure(h + 2)) header();
      if (kind === 'group') {
        d.rect(this.M, d.y, this.width, h, { fill: C.brandSoft });
        d.rect(this.M, d.y, 3, h, { fill: C.brand });
        zebra = 0;
      } else if (kind === 'subtotal') {
        d.rect(this.M, d.y, this.width, h, { fill: C.subtle });
        d.line(this.M, d.y, this.M + this.width, d.y, C.border, 0.6);
      } else if (kind === 'total') {
        d.rect(this.M, d.y, this.width, h + 2, { fill: C.navySoft });
        d.line(this.M, d.y, this.M + this.width, d.y, C.navy, 1.2);
      } else if (zebra++ % 2 === 1) d.rect(this.M, d.y, this.width, h, { fill: C.zebra });
      const bold = kind !== 'normal';
      if (kind === 'group') {
        d.text(r.cells.filter(Boolean).join('   ·   '), this.M + pad + 3, d.y + rowH - 4, { size, bold: true, color: C.brandDark, maxWidth: this.width - pad * 2 });
      } else {
        columns.forEach((c, i) => {
          const tone = r.tones?.[i];
          const opts = { size, bold: bold || !!tone, color: tone ? TONE[tone].fg : kind === 'total' ? C.navy : C.ink, align: c.align, maxWidth: widths[i] - pad * 2 };
          const ws = wrapped[i];
          if (ws) ws.forEach((l, k) => d.text(l, tx(c, i), d.y + rowH - 4 + k * lineH, opts));
          else d.text(r.cells[i] ?? '', tx(c, i), d.y + rowH - 4, opts);
        });
      }
      d.y += kind === 'total' ? h + 2 : h;
      if (kind === 'normal') d.line(this.M, d.y, this.M + this.width, d.y, C.line, 0.4);
    });
    d.line(this.M, d.y, this.M + this.width, d.y, C.border, 0.8);
    d.y += 14;
  }

  note(text: string) {
    const d = this.doc;
    for (const l of d.wrap(text, this.width, 7.5)) {
      this.ensure(10);
      d.y += 10;
      d.text(l, this.M, d.y, { size: 7.5, color: C.muted });
    }
    d.y += 8;
  }

  /** rodapés com confidencialidade e "Página x de y"; devolve o PDF */
  finish(): Buffer {
    const d = this.doc;
    const n = d.pageCount;
    for (let i = 0; i < n; i++) {
      d.onPage(i, () => {
        const y = d.height - 20;
        d.line(this.M, y - 11, this.M + this.width, y - 11, C.border, 0.6);
        d.rect(this.M, y - 8, 10, 10, { fill: C.brand, radius: 2.5 });
        d.text(`${this.meta.company} · ${this.meta.title}`, this.M + 16, y, { size: 7.5, bold: true, color: C.text, maxWidth: this.width * 0.55 });
        d.text('Documento confidencial · uso interno', this.M + this.width / 2 + 40, y, { size: 7, color: C.faint, align: 'center' });
        d.text(`Página ${i + 1} de ${n}`, this.M + this.width, y, { size: 7.5, bold: true, color: C.muted, align: 'right' });
      });
    }
    return d.toBuffer();
  }
}
