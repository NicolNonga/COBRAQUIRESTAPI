import { BusinessRuleError } from '@/shared/domain/errors';
import { ExternalCompany, ExternalCustomer, ExternalInvoice, ExternalPage } from '../../../domain/canonical';
import { ConnectionCheck, ErpConnector } from '../../../domain/erp-connector.port';
import { HttpResponse, HttpTransport } from './http-transport';
import { B1_CUSTOMER_FIELDS, B1_INVOICE_FIELDS, B1Customer, B1Invoice, B1MapOptions, customerFromB1, invoiceFromB1 } from './sap-b1.mapper';

export interface SapB1Config {
  baseUrl: string;
  companyDb: string;
  /** código que representa esta base no Cobraqui (por defeito, o próprio companyDb) */
  companyCode?: string;
  localCurrency?: string;
  referenceField?: 'DocNum' | 'NumAtCard';
  pageSize?: number;
  insecureTls?: boolean;
  timeoutMs?: number;
}

export interface SapB1Credentials {
  username: string;
  password: string;
}

const SL = '/b1s/v1';
const IDS_PER_QUERY = 40;
const RETRIES = 2;

/** OData: aspas simples duplicam-se. Todo o texto que vai para um $filter passa por aqui. */
export const odataString = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * SAP Business One via Service Layer (OData v3, `/b1s/v1`). Só leitura.
 *
 * - Autenticação: POST /Login devolve o cookie B1SESSION; expira (30 min por defeito) e o conector volta a entrar sozinho num 401.
 * - Paginação: `Prefer: odata.maxpagesize` e seguir `odata.nextLink`; o token de página é o próprio nextLink (só caminho relativo).
 * - Facturas = `Invoices` (A/R Invoice). Em aberto = DocumentStatus bost_Open e Cancelled tNO; o pago é PaidToDate (PaidFC em moeda estrangeira).
 * - Incremental: UpdateDate (só data) no servidor + UpdateTime no filtro final em memória; a sobreposição do cursor absorve a imprecisão.
 */
export class SapB1Connector implements ErpConnector {
  readonly provider = 'SAP_B1' as const;
  private cookie: string | null = null;
  private readonly base: string;
  private readonly map: B1MapOptions;
  private readonly pageSize: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly cfg: SapB1Config,
    private readonly creds: SapB1Credentials,
    private readonly http: HttpTransport,
  ) {
    this.base = cfg.baseUrl.replace(/\/+$/, '');
    this.map = { companyCode: cfg.companyCode || cfg.companyDb, localCurrency: (cfg.localCurrency || 'AOA').toUpperCase(), referenceField: cfg.referenceField ?? 'DocNum' };
    this.pageSize = Math.min(Math.max(cfg.pageSize ?? 200, 10), 1000);
    this.timeoutMs = cfg.timeoutMs ?? 20_000;
  }

  async testConnection(): Promise<ConnectionCheck> {
    const companies = await this.companies();
    const info = await this.get<{ value?: unknown[] }>(`/Invoices?$select=DocEntry&$filter=${encodeURIComponent(this.openFilter())}&$top=1&$inlinecount=allpages`, true);
    const count = (info as { 'odata.count'?: string })['odata.count'];
    return {
      companyCodes: companies.map((c) => c.code),
      openInvoices: count !== undefined ? Number(count) : null,
      details: `Business One, base ${this.cfg.companyDb}`,
    };
  }

  /** filiais (BusinessPlaces) se existirem; senão a própria empresa (dados em CompanyService_GetAdminInfo) */
  async companies(): Promise<ExternalCompany[]> {
    const bp = await this.get<{ value?: Array<{ BPLID: number; BPLName?: string; Email?: string; Phone1?: string; Street?: string; City?: string }> }>(
      '/BusinessPlaces?$select=BPLID,BPLName,Email,Phone1,Street,City&$filter=Disabled eq \'tNO\'', true,
    ).catch(() => ({ value: [] as never[] })); // filiais não activadas / sem permissão: usa a empresa
    if (bp.value?.length) {
      return bp.value.map((b) => ({ code: String(b.BPLID), name: (b.BPLName ?? `Filial ${b.BPLID}`).trim(), email: b.Email?.trim() || null, phone: b.Phone1?.trim() || null, address: [b.Street, b.City].filter(Boolean).join(', ') || null }));
    }
    let name = this.cfg.companyDb;
    let email: string | null = null;
    let phone: string | null = null;
    try {
      const res = await this.raw('POST', `${SL}/CompanyService_GetAdminInfo`, '{}', true);
      if (res.status < 300) {
        const a = JSON.parse(res.body) as { CompanyName?: string; EMail?: string; Phone1?: string };
        name = a.CompanyName?.trim() || name;
        email = a.EMail?.trim() || null;
        phone = a.Phone1?.trim() || null;
      }
    } catch { /* sem dados da empresa: fica o nome da base de dados */ }
    return [{ code: this.map.companyCode, name, email, phone, address: null }];
  }

  async invoicesChangedSince(since: string | null, pageToken: string | null): Promise<ExternalPage<ExternalInvoice>> {
    let path: string;
    if (pageToken) path = this.safeNext(pageToken);
    else {
      const filter = since ? `UpdateDate ge '${since.slice(0, 10)}'` : this.openFilter();
      path = `/Invoices?$select=${B1_INVOICE_FIELDS.join(',')}&$filter=${encodeURIComponent(filter)}&$orderby=${encodeURIComponent('UpdateDate,DocEntry')}`;
    }
    const res = await this.get<{ value: B1Invoice[]; 'odata.nextLink'?: string; '@odata.nextLink'?: string }>(path, true);
    let items = res.value.map((d) => invoiceFromB1(d, this.map));
    // UpdateDate só tem dia: refinar pela hora para não reler o dia inteiro em cada execução
    if (since) items = items.filter((i) => !i.changedAt || i.changedAt >= since);
    const next = res['odata.nextLink'] ?? res['@odata.nextLink'];
    return { items, next: next ? this.safeNext(next) : null };
  }

  async invoicesByIds(externalIds: string[]): Promise<ExternalInvoice[]> {
    const ids = externalIds.filter((i) => /^\d+$/.test(i));
    return this.queryInvoices(ids, (c) => c.map((id) => `DocEntry eq ${id}`).join(' or '));
  }

  async invoicesByReference(references: string[]): Promise<ExternalInvoice[]> {
    const field = this.map.referenceField;
    return this.queryInvoices(references, (c) =>
      c
        .map((r) => (field === 'DocNum' ? (/^\d+$/.test(r) ? `DocNum eq ${r}` : null) : `NumAtCard eq ${odataString(r)}`))
        .filter(Boolean)
        .join(' or ') || 'DocEntry eq -1',
    );
  }

  async customersByIds(externalIds: string[]): Promise<ExternalCustomer[]> {
    const out: ExternalCustomer[] = [];
    for (let i = 0; i < externalIds.length; i += IDS_PER_QUERY) {
      const filter = externalIds.slice(i, i + IDS_PER_QUERY).map((id) => `CardCode eq ${odataString(id)}`).join(' or ');
      let path: string | null = `/BusinessPartners?$select=${B1_CUSTOMER_FIELDS.join(',')}&$filter=${encodeURIComponent(filter)}`;
      while (path) {
        const res: { value: B1Customer[]; 'odata.nextLink'?: string } = await this.get(path, true);
        out.push(...res.value.map((c) => customerFromB1(c, this.map.companyCode)));
        path = res['odata.nextLink'] ? this.safeNext(res['odata.nextLink']) : null;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ internos

  /** em aberto e não anulada; clientes apenas (Invoices já são só de clientes) */
  private openFilter() {
    return "DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'";
  }

  private async queryInvoices(keys: string[], build: (chunk: string[]) => string): Promise<ExternalInvoice[]> {
    const out: ExternalInvoice[] = [];
    for (let i = 0; i < keys.length; i += IDS_PER_QUERY) {
      let path: string | null = `/Invoices?$select=${B1_INVOICE_FIELDS.join(',')}&$filter=${encodeURIComponent(build(keys.slice(i, i + IDS_PER_QUERY)))}`;
      while (path) {
        const res: { value: B1Invoice[]; 'odata.nextLink'?: string } = await this.get(path, true);
        out.push(...res.value.map((d) => invoiceFromB1(d, this.map)));
        path = res['odata.nextLink'] ? this.safeNext(res['odata.nextLink']) : null;
      }
    }
    return out;
  }

  /** o nextLink vem do servidor; só aceitamos caminhos do próprio Service Layer, nunca outro endereço */
  private safeNext(link: string): string {
    let p = link;
    if (/^https?:\/\//i.test(p)) {
      const u = new URL(p);
      if (u.origin !== new URL(this.base).origin) throw new BusinessRuleError('O ERP indicou uma página noutro endereço; pedido recusado');
      p = u.pathname + u.search;
    }
    p = p.replace(/^\/?b1s\/v1/, '').replace(/^\/b1s\/v1/, '');
    if (!p.startsWith('/')) p = `/${p}`;
    return p;
  }

  private async login(): Promise<void> {
    const res = await this.raw('POST', `${SL}/Login`, JSON.stringify({ CompanyDB: this.cfg.companyDb, UserName: this.creds.username, Password: this.creds.password }), false);
    if (res.status === 401 || res.status === 400) throw new BusinessRuleError(`O Business One recusou o início de sessão: ${this.errorText(res) || 'utilizador, palavra-passe ou base de dados inválidos'}`);
    if (res.status >= 300) throw new Error(`Início de sessão falhou (HTTP ${res.status}) ${this.errorText(res)}`);
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const cookies = list.map((c) => c.split(';')[0]).filter((c) => /^(B1SESSION|ROUTEID)=/.test(c));
    if (!cookies.some((c) => c.startsWith('B1SESSION='))) {
      let sid: string | undefined;
      try {
        sid = (JSON.parse(res.body) as { SessionId?: string }).SessionId;
      } catch {
        /* sem corpo JSON */
      }
      if (!sid) throw new Error('O Service Layer não devolveu sessão');
      cookies.push(`B1SESSION=${sid}`);
    }
    this.cookie = cookies.join('; ');
  }

  private async get<T>(path: string, retrySession: boolean): Promise<T> {
    if (!this.cookie) await this.login();
    const res = await this.raw('GET', `${SL}${path}`, undefined, true);
    if (res.status === 401 && retrySession) {
      this.cookie = null;
      return this.get<T>(path, false);
    }
    if (res.status >= 400) throw this.httpError(res);
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new Error('Resposta inválida do Service Layer (não é JSON)');
    }
  }

  private async raw(method: 'GET' | 'POST', path: string, body: string | undefined, withSession: boolean): Promise<HttpResponse> {
    let last: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        const res = await this.http.send({
          method,
          url: `${this.base}${path}`,
          body,
          timeoutMs: this.timeoutMs,
          insecureTls: this.cfg.insecureTls,
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            Prefer: `odata.maxpagesize=${this.pageSize}`,
            ...(withSession && this.cookie ? { Cookie: this.cookie } : {}),
          },
        });
        // 502/503/504 e 5xx transitórios: tentar de novo; 4xx é definitivo
        if (res.status >= 500 && attempt < RETRIES) {
          await this.sleep(300 * 2 ** attempt);
          continue;
        }
        return res;
      } catch (e) {
        last = e;
        if (attempt < RETRIES) await this.sleep(300 * 2 ** attempt);
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  protected sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private errorText(res: HttpResponse): string {
    try {
      const e = JSON.parse(res.body) as { error?: { message?: { value?: string } | string; code?: number | string } };
      const m = typeof e.error?.message === 'string' ? e.error.message : e.error?.message?.value;
      return m ? `${m}${e.error?.code ? ` (código ${e.error.code})` : ''}` : '';
    } catch {
      return '';
    }
  }

  private httpError(res: HttpResponse): Error {
    const text = this.errorText(res);
    if (res.status === 403) return new BusinessRuleError(`O utilizador do Business One não tem permissão para ler este dado${text ? `: ${text}` : ''}`);
    return new Error(`Service Layer respondeu HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }
}
