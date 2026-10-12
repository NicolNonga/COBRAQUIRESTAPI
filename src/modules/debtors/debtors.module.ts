import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as U from './application/debtor.use-cases';
import { DebtorQueries, DebtorRepository } from './domain/debtor.repository';
import { DebtorContactPersonOrmEntity, DebtorOrmEntity } from './infrastructure/debtor.orm-entities';
import { TypeOrmDebtorRepository } from './infrastructure/typeorm-debtor.repository';
import { DebtorsController } from './presentation/debtors.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DebtorOrmEntity, DebtorContactPersonOrmEntity])],
  controllers: [DebtorsController],
  providers: [
    TypeOrmDebtorRepository,
    { provide: DebtorRepository, useExisting: TypeOrmDebtorRepository },
    { provide: DebtorQueries, useExisting: TypeOrmDebtorRepository },
    U.CreateDebtorUseCase,
    U.UpdateDebtorUseCase,
    U.SetDebtorActiveUseCase,
    U.GetDebtorLogoUseCase,
    U.DebtorQueriesUseCase,
  ],
  exports: [DebtorRepository],
})
export class DebtorsModule {}
