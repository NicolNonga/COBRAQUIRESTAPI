import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreateContactTypeUseCase } from './application/create-contact-type.use-case';
import { ListCatalogUseCase } from './application/list-catalog.use-case';
import { CatalogReader, ContactTypeWriter } from './domain/catalog-reader.port';
import { StateCatalog } from './domain/state-catalog.port';
import * as E from './infrastructure/catalog.orm-entities';
import { TypeOrmCatalogRepository } from './infrastructure/typeorm-catalog.repository';
import { TypeOrmStateCatalog } from './infrastructure/typeorm-state-catalog';
import { CatalogsController } from './presentation/catalogs.controller';

@Global() // StateCatalog é usado por invoices/processes/jobs
@Module({
  imports: [
    TypeOrmModule.forFeature([
      E.CategoryOrmEntity,
      E.CurrencyOrmEntity,
      E.DebtorTypeOrmEntity,
      E.ContactTypeOrmEntity,
      E.InvoiceStateOrmEntity,
      E.ProcessStateOrmEntity,
    ]),
  ],
  controllers: [CatalogsController],
  providers: [
    TypeOrmCatalogRepository,
    { provide: CatalogReader, useExisting: TypeOrmCatalogRepository },
    { provide: ContactTypeWriter, useExisting: TypeOrmCatalogRepository },
    { provide: StateCatalog, useClass: TypeOrmStateCatalog },
    ListCatalogUseCase,
    CreateContactTypeUseCase,
  ],
  exports: [StateCatalog],
})
export class CatalogsModule {}
