import { Module } from '@nestjs/common';
import { CollectionCostsService } from './application/collection-costs.service';
import { ReportsService } from './application/reports.service';
import { SqlReportQueries } from './infrastructure/sql-report.queries';
import { ReportsController } from './presentation/reports.controller';

/** Estatísticas: indicadores de contas a receber, relatórios obrigatórios (JSON + PDF) e custos da operação. */
@Module({
  controllers: [ReportsController],
  providers: [SqlReportQueries, ReportsService, CollectionCostsService],
})
export class ReportsModule {}
