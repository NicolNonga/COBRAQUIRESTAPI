import { Module } from '@nestjs/common';
import { DebtorsModule } from '../debtors/debtors.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AttachInvoicePdfsUseCase } from './application/attach-invoice-pdfs.use-case';
import { ImportDebtorsUseCase } from './application/import-debtors.use-case';
import { ImportInvoicesUseCase } from './application/import-invoices.use-case';
import { ImportOrganizationsUseCase } from './application/import-organizations.use-case';
import { ImportErrorReportWriter, PdfTextExtractor, SpreadsheetReader } from './domain/spreadsheet.port';
import { ExcelJsErrorReportWriter, ExcelJsSpreadsheetReader } from './infrastructure/exceljs-spreadsheet';
import { PdfParseExtractor } from './infrastructure/pdf-parse-extractor';
import { ImportsController } from './presentation/imports.controller';
import { ImportHistoryController } from './presentation/import-history.controller';
import { ImportHistoryService } from './application/import-history.service';

@Module({
  imports: [DebtorsModule, OrganizationsModule, InvoicesModule],
  controllers: [ImportsController, ImportHistoryController],
  providers: [
    { provide: SpreadsheetReader, useClass: ExcelJsSpreadsheetReader },
    { provide: ImportErrorReportWriter, useClass: ExcelJsErrorReportWriter },
    { provide: PdfTextExtractor, useClass: PdfParseExtractor },
    ImportDebtorsUseCase,
    ImportInvoicesUseCase,
    ImportOrganizationsUseCase,
    AttachInvoicePdfsUseCase,
    ImportHistoryService,
  ],
})
export class ImportsModule {}
