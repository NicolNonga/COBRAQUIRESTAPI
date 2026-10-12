import { ErpProvider, ExternalCompany, ExternalCustomer, ExternalInvoice, ExternalPage } from './canonical';

export interface ConnectionCheck {
  /** empresas (company codes) visíveis com estas credenciais */
  companyCodes: string[];
  /** quantas facturas em aberto o ERP mostra (amostra; pode ser aproximado) */
  openInvoices: number | null;
  details?: string;
}

/**
 * Contrato de um ERP. Só leitura: a v1 nunca escreve no ERP.
 * Uma instância é criada por execução, já com a configuração e as credenciais decifradas.
 */
export interface ErpConnector {
  readonly provider: ErpProvider;

  testConnection(): Promise<ConnectionCheck>;

  /** empresas do ERP: cada uma passa a ser um credor no Cobraqui (criado sozinho na primeira sincronização) */
  companies(): Promise<ExternalCompany[]>;

  /**
   * Facturas de clientes alteradas desde `since` (ISO), em qualquer estado.
   * `since = null` → todas as facturas EM ABERTO (carga completa).
   */
  invoicesChangedSince(since: string | null, pageToken: string | null): Promise<ExternalPage<ExternalInvoice>>;

  /** estado actual de facturas concretas; as que já não existem no ERP não vêm na resposta */
  invoicesByIds(externalIds: string[]): Promise<ExternalInvoice[]>;

  /** facturas pelo número visível ao devedor (para ligar facturas que já existiam no Cobraqui) */
  invoicesByReference(references: string[]): Promise<ExternalInvoice[]>;

  customersByIds(externalIds: string[]): Promise<ExternalCustomer[]>;
}

/** Cria o conector certo para o fornecedor configurado. */
export abstract class ErpConnectorFactory {
  abstract providers(): Array<{ provider: ErpProvider; available: boolean; label: string }>;
  /** erros de configuração (vazio = válida) */
  abstract validateConfig(provider: ErpProvider, config: Record<string, unknown>): string[];
  abstract create(provider: ErpProvider, config: Record<string, unknown>, credentials: Record<string, string> | null): ErpConnector;
}
