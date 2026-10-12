import { Injectable } from '@nestjs/common';
import { Page, PageRequest } from '@/shared/domain/pagination';
import { CatalogItem, CatalogKind, CatalogReader } from '../domain/catalog-reader.port';

@Injectable()
export class ListCatalogUseCase {
  constructor(private readonly reader: CatalogReader) {}

  dropdown(kind: CatalogKind): Promise<CatalogItem[]> {
    return this.reader.listActive(kind);
  }

  paginate(kind: CatalogKind, req: PageRequest): Promise<Page<CatalogItem>> {
    return this.reader.paginate(kind, req);
  }
}
