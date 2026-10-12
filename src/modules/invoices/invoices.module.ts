import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreateInvoiceUseCase } from './application/create-invoice.use-case';
import { InvoiceDocumentUseCases } from './application/invoice-document.use-cases';
import { UpdateInvoiceUseCase } from './application/update-invoice.use-case';
import { InvoiceQueriesUseCase } from './application/invoice-queries.use-case';
import { MarkOverdueInvoicesUseCase } from './application/mark-overdue-invoices.use-case';
import { InvoiceQueries, InvoiceRepository } from './domain/invoice.repository';
import { InvoiceOrmEntity } from './infrastructure/invoice.orm-entity';
import { TypeOrmInvoiceRepository } from './infrastructure/typeorm-invoice.repository';
import { InvoicesController } from './presentation/invoices.controller';

@Module({
  imports: [TypeOrmModule.forFeature([InvoiceOrmEntity])],
  controllers: [InvoicesController],
  providers: [
    TypeOrmInvoiceRepository,
    { provide: InvoiceRepository, useExisting: TypeOrmInvoiceRepository },
    { provide: InvoiceQueries, useExisting: TypeOrmInvoiceRepository },
    CreateInvoiceUseCase,
    InvoiceQueriesUseCase,
    InvoiceDocumentUseCases,
    UpdateInvoiceUseCase,
    MarkOverdueInvoicesUseCase,
  ],
  exports: [InvoiceRepository, MarkOverdueInvoicesUseCase],
})
export class InvoicesModule {}
