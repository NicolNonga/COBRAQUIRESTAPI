import { Module } from '@nestjs/common';
import * as U from './application/creditor-accounts.use-cases';
import { CreditorAccounts, CreditorLedger } from './domain/creditor-ledger.port';
import { SettlementRepository } from './domain/settlement';
import { TypeOrmCreditorAccounts, TypeOrmSettlementRepository } from './infrastructure/typeorm-creditor-accounts';
import { CreditorAccountsController } from './presentation/creditor-accounts.controller';

/**
 * Conta-corrente por credor (comissões, valores recebidos em nome do credor, repasses).
 * Exporta só a porta `CreditorLedger` — o módulo de pagamentos depende da abstracção, não da implementação.
 */
@Module({
  controllers: [CreditorAccountsController],
  providers: [
    TypeOrmCreditorAccounts,
    { provide: CreditorLedger, useExisting: TypeOrmCreditorAccounts },
    { provide: CreditorAccounts, useExisting: TypeOrmCreditorAccounts },
    { provide: SettlementRepository, useClass: TypeOrmSettlementRepository },
    U.CreditorAccountQueriesUseCase,
    U.SetCommissionRateUseCase,
    U.RegisterSettlementUseCase,
    U.ConfirmSettlementUseCase,
    U.CancelSettlementUseCase,
  ],
  exports: [CreditorLedger],
})
export class CreditorAccountsModule {}
