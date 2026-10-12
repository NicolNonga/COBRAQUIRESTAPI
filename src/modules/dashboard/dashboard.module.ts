import { Module } from '@nestjs/common';
import { DashboardUseCase } from './application/dashboard.use-case';
import { DashboardQueries } from './domain/dashboard.port';
import { SqlDashboardQueries } from './infrastructure/sql-dashboard.queries';
import { DashboardController } from './presentation/dashboard.controller';

@Module({
  controllers: [DashboardController],
  providers: [{ provide: DashboardQueries, useClass: SqlDashboardQueries }, DashboardUseCase],
})
export class DashboardModule {}
