import { Page, PageRequest } from '@/shared/domain/pagination';

export interface CatalogItem {
  id: number;
  name: string;
  [k: string]: unknown;
}

export type CatalogKind = 'categories' | 'currencies' | 'debtorTypes' | 'contactTypes' | 'invoiceStates' | 'processStates';

/** Leitura de catálogos (Interface Segregation: só leitura). */
export abstract class CatalogReader {
  abstract listActive(kind: CatalogKind): Promise<CatalogItem[]>;
  abstract paginate(kind: CatalogKind, req: PageRequest): Promise<Page<CatalogItem>>;
}

/** Escrita de tipos de contacto (único catálogo editável via API no original). */
export abstract class ContactTypeWriter {
  abstract create(data: { name: string; description?: string | null }): Promise<{ id: number }>;
}
