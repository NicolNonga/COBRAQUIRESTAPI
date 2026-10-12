import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InvoiceStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { DebtorRepository } from '@/modules/debtors/domain/debtor.repository';
import { InvoiceFactory, NewInvoice } from '@/modules/invoices/domain/invoice';
import { InvoiceRepository } from '@/modules/invoices/domain/invoice.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { DomainError } from '@/shared/domain/errors';
import { ImportErrorReportWriter, ImportSummary, pick, RowError, SpreadsheetReader } from '../domain/spreadsheet.port';

/** "1.234,56" | "1234.56" | "1 234,56" → "1234.56" */
const parseAmount = (raw: string): string | null => {
  const s = raw.replace(/\s/g, '');
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? normalized : null;
};

/** Nomes alternativos usados em ERPs/Excel para a mesma moeda (ISO-4217 à direita). */
const CURRENCY_ALIASES: Record<string, string> = {
  akz: 'aoa', kz: 'aoa', kwanza: 'aoa', kwanzas: 'aoa', 'kz.': 'aoa',
  usd: 'usd', 'us$': 'usd', dolar: 'usd', 'dólar': 'usd', dolares: 'usd', 'dólares': 'usd',
  eur: 'eur', euro: 'eur', euros: 'eur', '€': 'eur',
};

/** aceita YYYY-MM-DD ou DD/MM/YYYY */
const parseDate = (raw: string): string | null => {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

@Injectable()
export class ImportInvoicesUseCase {
  private readonly logger = new Logger(ImportInvoicesUseCase.name);
  static readonly MAX_ROWS = 20_000;

  constructor(
    private readonly reader: SpreadsheetReader,
    private readonly report: ImportErrorReportWriter,
    private readonly invoices: InvoiceRepository,
    private readonly debtors: DebtorRepository,
    private readonly states: StateCatalog,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(file: Buffer, userId: number): Promise<ImportSummary> {
    const stateId = await this.states.invoiceStateId(InvoiceStateCode.IN_PROGRESS);
    const rows = (await this.reader.read(file, ImportInvoicesUseCase.MAX_ROWS)).map((r) => ({
      rowNumber: r.rowNumber,
      reference: pick(r, 'Número', 'Numero'),
      amount: pick(r, 'Quantia', 'Valor'),
      currency: pick(r, 'Moeda'),
      debtor: pick(r, 'Devedor'),
      nif: pick(r, 'NIF'),
      timeLimit: pick(r, 'Prazo Pagamento'),
      issueDate: pick(r, 'Data de Emissão', 'Data de Emissao'),
    }));

    // lookups em lote (o original fazia 3 queries por linha)
    const [existingRefs, debtorIds, currencies] = await Promise.all([
      this.invoices.existingReferences(rows.map((r) => r.reference).filter(Boolean)),
      this.debtors.findIdsByNameAndNif(rows.filter((r) => r.debtor && r.nif).map((r) => ({ name: r.debtor, nif: r.nif }))),
      this.ds.query('SELECT id, code AS "rawCode", lower(code) AS code, lower(symbol) AS symbol, lower(name) AS name FROM currencies WHERE is_active') as Promise<Array<{ id: number; rawCode: string; code: string; symbol: string; name: string }>>,
    ]);
    // aceita código ISO (AOA), símbolo (Kz), nome (Kwanza) e aliases comuns (AKZ)
    const currencyOf = (v: string) => {
      const k = v.trim().toLowerCase();
      if (!k) return undefined;
      const iso = CURRENCY_ALIASES[k] ?? k;
      return currencies.find((c) => c.code === iso || c.symbol === k || c.name === k)?.id;
    };
    const currencyList = currencies.map((c) => c.rawCode).join(', ');

    // para explicar porque é que o devedor não foi encontrado (nome existe com outro NIF, ou o contrário)
    const candidates = (await this.ds.query(
      `SELECT name, nif FROM debtors WHERE lower(name) = ANY($1::text[]) OR lower(nif) = ANY($2::text[])`,
      [[...new Set(rows.map((r) => r.debtor.toLowerCase()).filter(Boolean))], [...new Set(rows.map((r) => r.nif.toLowerCase()).filter(Boolean))]],
    )) as Array<{ name: string; nif: string }>;
    const byName = new Map(candidates.map((c) => [c.name.toLowerCase(), c]));
    const byNif = new Map(candidates.map((c) => [String(c.nif).toLowerCase(), c]));
    const debtorProblem = (name: string, nif: string): string => {
      if (!name) return 'Devedor obrigatório';
      if (!nif) return 'NIF do devedor obrigatório';
      const n = byName.get(name.toLowerCase());
      const f = byNif.get(nif.toLowerCase());
      if (f) return `O NIF ${nif} pertence ao devedor "${f.name}", não a "${name}"`;
      if (n) return `O devedor "${name}" está registado com o NIF ${n.nif}, não ${nif}`;
      return `Devedor "${name}" (NIF ${nif}) não está registado — importe-o primeiro em Devedores`;
    };

    const errors: RowError[] = [];
    const seenRefs = new Set<string>();
    const valid: NewInvoice[] = [];

    for (const r of rows) {
      const e: string[] = [];
      const refKey = r.reference.toLowerCase();
      if (!r.reference) e.push('Número da factura obrigatório');
      else if (existingRefs.has(refKey)) e.push('Número da factura já existe');
      else if (seenRefs.has(refKey)) e.push('Número duplicado no ficheiro');
      const debtorId = debtorIds.get(`${r.debtor.toLowerCase()}|${r.nif.toLowerCase()}`);
      if (!debtorId) e.push(debtorProblem(r.debtor, r.nif));
      const currencyId = currencyOf(r.currency);
      if (!currencyId) e.push(r.currency ? `Moeda "${r.currency}" não reconhecida — use ${currencyList}` : `Moeda obrigatória (${currencyList})`);
      const amount = parseAmount(r.amount);
      if (!amount) e.push('Quantia inválida');
      const issueDate = parseDate(r.issueDate);
      if (!issueDate) e.push('Data de emissão inválida');
      const timeLimit = Number(r.timeLimit);

      if (!e.length) {
        try {
          valid.push(
            InvoiceFactory.build({
              referenceNumber: r.reference,
              amount: amount!,
              issueDate: issueDate!,
              timeLimitDays: timeLimit,
              debtorId: debtorId!,
              currencyId: currencyId!,
              invoiceStateId: stateId,
              createdById: userId,
            }),
          );
          seenRefs.add(refKey);
          continue;
        } catch (err) {
          e.push(err instanceof DomainError ? err.message : 'Linha inválida');
        }
      }
      errors.push({ rowNumber: r.rowNumber, errors: e });
    }

    const imported = valid.length
      ? await this.uow.run(async () => {
          const n = await this.invoices.bulkCreate(valid);
          await this.audit.record({ action: 'INVOICES_IMPORTED', entity: 'invoice', payload: { imported: n, failed: errors.length } });
          return n;
        })
      : 0;
    const errorReport = errors.length ? await this.report.write(file, errors, 'erros_facturas') : undefined;
    this.logger.log({ total: rows.length, imported, failed: errors.length }, 'Import de facturas concluído');
    return { total: rows.length, imported, failed: errors.length, errors, errorReport };
  }
}
