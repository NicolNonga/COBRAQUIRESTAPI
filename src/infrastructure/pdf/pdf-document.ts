import { deflateSync } from 'node:zlib';

/**
 * Gerador de PDF mínimo, sem dependências: A4, fontes base Helvetica/Helvetica-Bold (WinAnsi →
 * acentos portugueses, €, «», º/ª), texto, linhas, rectângulos e paginação. Coordenadas em pontos,
 * com origem no CANTO SUPERIOR ESQUERDO (y cresce para baixo) — a conversão para PDF é interna.
 */

export type Rgb = [number, number, number];
export const hex = (h: string): Rgb => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/* ───────── larguras AFM (1/1000 em) para 32..126 ───────── */
// prettier-ignore
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Unicode → byte WinAnsi (CP1252). Latin-1 (0xA0–0xFF) coincide. */
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, '−': 0x96,
};
const SPECIAL_W: Record<number, [number, number]> = {
  0x80: [556, 556], 0x82: [222, 278], 0x84: [333, 500], 0x85: [1000, 1000], 0x91: [222, 278], 0x92: [222, 278], 0x93: [333, 500],
  0x94: [333, 500], 0x95: [350, 350], 0x96: [556, 556], 0x97: [1000, 1000], 0x99: [1000, 1000], 0xa0: [278, 278], 0xaa: [370, 370],
  0xba: [365, 365], 0xab: [556, 556], 0xbb: [556, 556], 0xb0: [400, 400], 0xb7: [278, 278], 0xa7: [556, 556], 0xbf: [611, 611], 0xa1: [333, 333],
};

const toBytes = (s: string): number[] =>
  [...s.normalize('NFC')].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c <= 0x7e) return c;
    if (CP1252[ch]) return CP1252[ch];
    if (c >= 0xa0 && c <= 0xff) return c;
    if (c === 0x09 || c === 0x0a) return 0x20;
    if (c === 0x202f || c === 0x2009) return 0xa0; // espaços finos (Intl pt-AO) → espaço não separável
    return 0x3f; // '?'
  });

const byteWidth = (b: number, bold: boolean): number => {
  if (b >= 0x20 && b <= 0x7e) return (bold ? HELV_B : HELV)[b - 0x20];
  if (SPECIAL_W[b]) return SPECIAL_W[b][bold ? 1 : 0];
  if (b >= 0xc0) {
    // letras acentuadas: largura da letra base
    const base = String.fromCharCode(b).normalize('NFD')[0];
    const bc = base.charCodeAt(0);
    if (bc >= 0x20 && bc <= 0x7e) return (bold ? HELV_B : HELV)[bc - 0x20];
    return bold ? 611 : 556; // ß, æ, ø…
  }
  return 556;
};

export interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: Rgb | string;
  align?: 'left' | 'right' | 'center';
  /** corta com "…" se exceder */
  maxWidth?: number;
}

export class PdfDocument {
  readonly width: number;
  readonly height: number;
  private pages: string[][] = [];
  private current: string[] = [];
  /** cursor vertical gerido pelos construtores de relatórios */
  y = 0;

  constructor(readonly opts: { landscape?: boolean; title?: string; author?: string } = {}) {
    const [w, h] = [595.28, 841.89];
    this.width = opts.landscape ? h : w;
    this.height = opts.landscape ? w : h;
    this.addPage();
  }

  get pageCount() {
    return this.pages.length;
  }
  get pageIndex() {
    return this.pages.indexOf(this.current);
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
    this.y = 0;
  }

  /** executa desenho noutra página (p.ex. rodapés no fim, quando já se sabe o total) */
  onPage(index: number, draw: () => void) {
    const keep = this.current;
    this.current = this.pages[index];
    draw();
    this.current = keep;
  }

  textWidth(s: string, size = 10, bold = false): number {
    return (toBytes(s).reduce((n, b) => n + byteWidth(b, bold), 0) * size) / 1000;
  }

  /** corta o texto para caber em maxWidth, terminando em "…" */
  fit(s: string, maxWidth: number, size = 10, bold = false): string {
    if (this.textWidth(s, size, bold) <= maxWidth) return s;
    let out = s;
    while (out.length > 1 && this.textWidth(`${out}…`, size, bold) > maxWidth) out = out.slice(0, -1);
    return `${out.trimEnd()}…`;
  }

  /** quebra em linhas por palavras */
  wrap(s: string, maxWidth: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    for (const para of String(s ?? '').split(/\n/)) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (this.textWidth(next, size, bold) <= maxWidth) line = next;
        else {
          if (line) lines.push(line);
          line = this.textWidth(word, size, bold) > maxWidth ? this.fit(word, maxWidth, size, bold) : word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  private color(c: Rgb | string | undefined, op: 'rg' | 'RG') {
    const [r, g, b] = typeof c === 'string' ? hex(c) : (c ?? [0, 0, 0]);
    return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} ${op}`;
  }

  /** y = linha de base do texto (a partir do topo) */
  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const size = o.size ?? 10;
    const bold = !!o.bold;
    let str = String(s ?? '');
    if (o.maxWidth) str = this.fit(str, o.maxWidth, size, bold);
    const w = this.textWidth(str, size, bold);
    const tx = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    const hexStr = toBytes(str).map((b) => b.toString(16).padStart(2, '0')).join('');
    this.current.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${this.color(o.color, 'rg')} ${tx.toFixed(2)} ${(this.height - y).toFixed(2)} Td <${hexStr}> Tj ET`);
    return w;
  }

  rect(x: number, y: number, w: number, h: number, o: { fill?: Rgb | string; stroke?: Rgb | string; lineWidth?: number; radius?: number } = {}) {
    const ops: string[] = ['q'];
    if (o.fill) ops.push(this.color(o.fill, 'rg'));
    if (o.stroke) ops.push(this.color(o.stroke, 'RG'), `${o.lineWidth ?? 0.5} w`);
    const py = this.height - y - h;
    const r = Math.min(o.radius ?? 0, w / 2, h / 2);
    if (r > 0) {
      const k = 0.5523 * r;
      const [x0, y0, x1, y1] = [x, py, x + w, py + h];
      ops.push(
        `${(x0 + r).toFixed(2)} ${y0.toFixed(2)} m`,
        `${(x1 - r).toFixed(2)} ${y0.toFixed(2)} l`,
        `${(x1 - r + k).toFixed(2)} ${y0.toFixed(2)} ${x1.toFixed(2)} ${(y0 + r - k).toFixed(2)} ${x1.toFixed(2)} ${(y0 + r).toFixed(2)} c`,
        `${x1.toFixed(2)} ${(y1 - r).toFixed(2)} l`,
        `${x1.toFixed(2)} ${(y1 - r + k).toFixed(2)} ${(x1 - r + k).toFixed(2)} ${y1.toFixed(2)} ${(x1 - r).toFixed(2)} ${y1.toFixed(2)} c`,
        `${(x0 + r).toFixed(2)} ${y1.toFixed(2)} l`,
        `${(x0 + r - k).toFixed(2)} ${y1.toFixed(2)} ${x0.toFixed(2)} ${(y1 - r + k).toFixed(2)} ${x0.toFixed(2)} ${(y1 - r).toFixed(2)} c`,
        `${x0.toFixed(2)} ${(y0 + r).toFixed(2)} l`,
        `${x0.toFixed(2)} ${(y0 + r - k).toFixed(2)} ${(x0 + r - k).toFixed(2)} ${y0.toFixed(2)} ${(x0 + r).toFixed(2)} ${y0.toFixed(2)} c h`,
      );
    } else {
      ops.push(`${x.toFixed(2)} ${py.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    }
    ops.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S', 'Q');
    this.current.push(ops.join(' '));
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb | string = '#d0d5dd', width = 0.5) {
    this.current.push(`q 1 J ${this.color(color, 'RG')} ${width} w ${x1.toFixed(2)} ${(this.height - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.height - y2).toFixed(2)} l S Q`);
  }

  /** polígono (pontos em coordenadas de topo-esquerda) */
  polygon(points: Array<[number, number]>, o: { fill?: Rgb | string; stroke?: Rgb | string; lineWidth?: number } = {}) {
    if (points.length < 3) return;
    const ops: string[] = ['q'];
    if (o.fill) ops.push(this.color(o.fill, 'rg'));
    if (o.stroke) ops.push(this.color(o.stroke, 'RG'), `${o.lineWidth ?? 0.5} w`);
    points.forEach(([x, y], i) => ops.push(`${x.toFixed(2)} ${(this.height - y).toFixed(2)} ${i === 0 ? 'm' : 'l'}`));
    ops.push('h', o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S', 'Q');
    this.current.push(ops.join(' '));
  }

  circle(cx: number, cy: number, r: number, o: { fill?: Rgb | string; stroke?: Rgb | string; lineWidth?: number } = {}) {
    const k = 0.5523 * r;
    const py = this.height - cy;
    const f = (n: number) => n.toFixed(2);
    const ops: string[] = ['q'];
    if (o.fill) ops.push(this.color(o.fill, 'rg'));
    if (o.stroke) ops.push(this.color(o.stroke, 'RG'), `${o.lineWidth ?? 0.5} w`);
    ops.push(
      `${f(cx + r)} ${f(py)} m`,
      `${f(cx + r)} ${f(py + k)} ${f(cx + k)} ${f(py + r)} ${f(cx)} ${f(py + r)} c`,
      `${f(cx - k)} ${f(py + r)} ${f(cx - r)} ${f(py + k)} ${f(cx - r)} ${f(py)} c`,
      `${f(cx - r)} ${f(py - k)} ${f(cx - k)} ${f(py - r)} ${f(cx)} ${f(py - r)} c`,
      `${f(cx + k)} ${f(py - r)} ${f(cx + r)} ${f(py - k)} ${f(cx + r)} ${f(py)} c h`,
      o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S',
      'Q',
    );
    this.current.push(ops.join(' '));
  }

  /** gradiente horizontal por faixas finas */
  gradientH(x: number, y: number, w: number, h: number, from: string, to: string, steps = 40) {
    const a = hex(from);
    const b = hex(to);
    const sw = w / steps;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const c: Rgb = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      this.rect(x + i * sw, y, sw + 0.6, h, { fill: c });
    }
  }

  /** sector de anel (donut): ângulos em graus, 0 = topo, sentido horário */
  ringSector(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number, fill: Rgb | string) {
    const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 3));
    const pt = (r: number, a: number): [number, number] => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) pts.push(pt(rOuter, a0 + ((a1 - a0) * i) / steps));
    for (let i = steps; i >= 0; i--) pts.push(pt(rInner, a0 + ((a1 - a0) * i) / steps));
    this.polygon(pts, { fill });
  }

  /** serializa o documento */
  toBuffer(): Buffer {
    const objs: Buffer[] = [];
    const add = (body: string | Buffer) => { objs.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')); return objs.length; };
    const pdfStr = (s: string) => `<FEFF${Buffer.from(s, 'utf16le').swap16().toString('hex')}>`;

    const catalogId = add(''); // placeholders
    const pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds: number[] = [];
    for (const ops of this.pages) {
      const raw = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${raw.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), raw, Buffer.from('\nendstream', 'latin1')]));
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width.toFixed(2)} ${this.height.toFixed(2)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`));
    }
    objs[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
    objs[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1');
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const created = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    const infoId = add(`<< /Title ${pdfStr(this.opts.title ?? 'Relatório')} /Author ${pdfStr(this.opts.author ?? 'Cobraqui')} /Producer (Cobraqui) /CreationDate (${created}) >>`);

    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = parts[0].length;
    const xref: number[] = [];
    objs.forEach((body, i) => {
      xref.push(offset);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(chunk);
      offset += chunk.length;
    });
    const xrefStr = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    parts.push(Buffer.from(`${xrefStr}trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(parts);
  }
}
