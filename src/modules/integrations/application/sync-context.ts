import { ExternalCustomer } from '../domain/canonical';
import { ErpConnector } from '../domain/erp-connector.port';
import { IntegrationSettings, RunCounters, RunReportLine } from '../domain/integration.repository';

const REPORT_CAP = 1000;

/** Estado de uma execução: contadores, relatório e caches. Uma instância por execução. */
export class SyncContext {
  readonly counters: RunCounters = {};
  readonly report: RunReportLine[] = [];
  readonly customers = new Map<string, ExternalCustomer>();
  /** id externo da factura → já tratado nesta execução (evita repetir na varredura final) */
  readonly handled = new Set<string>();
  private truncated = false;

  constructor(
    readonly runId: number,
    readonly dryRun: boolean,
    readonly settings: IntegrationSettings,
    readonly connector: ErpConnector,
    /** empresa no ERP → credor */
    readonly companies: Map<string, number>,
    readonly currencies: Map<string, number>,
    readonly startedAt: Date,
  ) {}

  count(key: string, n = 1): void {
    if (n) this.counters[key] = (this.counters[key] ?? 0) + n;
  }

  /** na simulação regista todas as acções; numa execução real só o que merece atenção */
  log(line: RunReportLine, always = false): void {
    if (!this.dryRun && !always) return;
    if (this.report.length < REPORT_CAP) this.report.push(line);
    else if (!this.truncated) {
      this.truncated = true;
      this.report.push({ action: 'TRUNCATED', message: `Relatório limitado a ${REPORT_CAP} linhas; os contadores incluem tudo.` });
    }
  }
}
