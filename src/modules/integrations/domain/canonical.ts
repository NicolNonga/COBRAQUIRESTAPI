/**
 * Modelo canónico: o que o Cobraqui precisa de saber do ERP, igual para SAP S/4HANA, Business One ou Primavera.
 * Cada conector traduz os seus campos para isto; o resto do módulo não conhece o ERP.
 * Valores monetários em texto com 2 casas ("1234.50"); datas em "YYYY-MM-DD".
 */

export const ERP_PROVIDERS = ['SAP_S4', 'SAP_B1', 'FILE', 'SANDBOX'] as const;
export type ErpProvider = (typeof ERP_PROVIDERS)[number];

/** Estado da factura no ERP. */
export type ExternalStatus = 'OPEN' | 'PARTIAL' | 'CLEARED' | 'CANCELLED';

/** Empresa do ERP = credor no Cobraqui (S/4: company code; B1: filial/BPL, ou a própria empresa). */
export interface ExternalCompany {
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface ExternalCustomer {
  /** chave estável do cliente no ERP (S/4: Customer; B1: CardCode) */
  externalId: string;
  companyCode: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isCompany: boolean;
}

export interface ExternalInvoice {
  /** chave estável da factura no ERP (S/4: Empresa/Ano/Documento/Linha; B1: DocEntry) */
  externalId: string;
  /** empresa do ERP onde está lançada → credor no Cobraqui */
  companyCode: string;
  customerExternalId: string;
  /** número como aparece ao devedor (é o que se compara com as facturas já existentes) */
  reference: string;
  issueDate: string;
  dueDate: string;
  amount: string;
  /** valor ainda por pagar no ERP */
  openAmount: string;
  /** ISO-4217 (AOA, USD, EUR) */
  currency: string;
  status: ExternalStatus;
  /** última alteração no ERP (ISO), usada como cursor da leitura incremental */
  changedAt: string | null;
}

export interface ExternalPage<T> {
  items: T[];
  /** token para a página seguinte; null quando acabou */
  next: string | null;
}
