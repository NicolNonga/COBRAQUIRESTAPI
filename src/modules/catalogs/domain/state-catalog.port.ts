import { InvoiceStateCode, ProcessStateCode } from '../infrastructure/catalog.orm-entities';

export { InvoiceStateCode, ProcessStateCode };

/** Resolve ids de estados a partir de códigos estáveis (com cache em memória). */
export abstract class StateCatalog {
  abstract invoiceStateId(code: InvoiceStateCode): Promise<number>;
  abstract processStateId(code: ProcessStateCode): Promise<number>;
}
