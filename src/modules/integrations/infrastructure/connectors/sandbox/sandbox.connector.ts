import { ExternalCompany, ExternalCustomer, ExternalInvoice, ExternalPage } from '../../../domain/canonical';
import { ConnectionCheck, ErpConnector } from '../../../domain/erp-connector.port';

export interface SandboxData {
  customers: ExternalCustomer[];
  invoices: ExternalInvoice[];
  companies?: ExternalCompany[];
}

const PAGE = 500;

/**
 * ERP de testes: os dados vivem na própria configuração (`config.sandbox`).
 * Serve para correr o fluxo de ponta a ponta sem SAP. Indisponível em produção.
 */
export class SandboxConnector implements ErpConnector {
  readonly provider = 'SANDBOX' as const;

  constructor(private readonly data: SandboxData) {}

  async testConnection(): Promise<ConnectionCheck> {
    return {
      companyCodes: [...new Set(this.data.invoices.map((i) => i.companyCode))],
      openInvoices: this.data.invoices.filter((i) => i.status === 'OPEN' || i.status === 'PARTIAL').length,
      details: `${this.data.customers.length} clientes e ${this.data.invoices.length} facturas de teste`,
    };
  }

  async companies(): Promise<ExternalCompany[]> {
    if (this.data.companies?.length) return this.data.companies;
    return [...new Set(this.data.invoices.map((i) => i.companyCode))].map((code) => ({ code, name: `Empresa ${code}`, email: null, phone: null, address: null }));
  }

  async invoicesChangedSince(since: string | null, pageToken: string | null): Promise<ExternalPage<ExternalInvoice>> {
    const all = this.data.invoices
      .filter((i) => (since === null ? i.status === 'OPEN' || i.status === 'PARTIAL' : !i.changedAt || i.changedAt >= since))
      .sort((a, b) => (a.changedAt ?? '').localeCompare(b.changedAt ?? '') || a.externalId.localeCompare(b.externalId));
    const offset = Number(pageToken ?? 0);
    const items = all.slice(offset, offset + PAGE);
    return { items, next: offset + PAGE < all.length ? String(offset + PAGE) : null };
  }

  async invoicesByIds(externalIds: string[]): Promise<ExternalInvoice[]> {
    const want = new Set(externalIds);
    return this.data.invoices.filter((i) => want.has(i.externalId));
  }

  async invoicesByReference(references: string[]): Promise<ExternalInvoice[]> {
    const want = new Set(references.map((r) => r.toLowerCase()));
    return this.data.invoices.filter((i) => want.has(i.reference.toLowerCase()));
  }

  async customersByIds(externalIds: string[]): Promise<ExternalCustomer[]> {
    const want = new Set(externalIds);
    return this.data.customers.filter((c) => want.has(c.externalId));
  }
}
