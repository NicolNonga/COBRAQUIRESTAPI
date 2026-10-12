import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditorAccountsModule } from '../creditor-accounts/creditor-accounts.module';
import { UsersModule } from '../users/users.module';
import { PaymentAuthority } from './application/payment-authority';
import { CurrenciesAdminUseCase, PaymentMethodsUseCase } from './application/payment-catalog.use-cases';
import { CancelPaymentUseCase, ConfirmPaymentUseCase, ReversePaymentUseCase } from './application/payment-decision.use-cases';
import { PaymentQueriesUseCase } from './application/payment-queries.use-case';
import { PAYMENT_SETTINGS, PaymentSettings } from './application/payment-settings';
import { RegisterPaymentUseCase } from './application/register-payment.use-case';
import {
  CurrencyAdminRepository,
  DebtorCreditRepository,
  PaymentMethodRepository,
  PaymentRepository,
  PaymentSettlementRepository,
} from './domain/payment.repository';
import { PaymentMethodOrmEntity, PaymentOrmEntity } from './infrastructure/payment.orm-entities';
import { TypeOrmCurrencyAdminRepository, TypeOrmPaymentMethodRepository } from './infrastructure/typeorm-payment-catalog.repository';
import { TypeOrmDebtorCreditRepository, TypeOrmPaymentRepository, TypeOrmPaymentSettlementRepository } from './infrastructure/typeorm-payment.repository';
import { PaymentSettingsController, PaymentsController } from './presentation/payments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentOrmEntity, PaymentMethodOrmEntity]), UsersModule, CreditorAccountsModule],
  controllers: [PaymentsController, PaymentSettingsController],
  providers: [
    {
      provide: PAYMENT_SETTINGS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): PaymentSettings => ({ baseCurrencyCode: String(cfg.get('BASE_CURRENCY_CODE', 'AOA')).toUpperCase() }),
    },
    { provide: PaymentRepository, useClass: TypeOrmPaymentRepository },
    { provide: PaymentSettlementRepository, useClass: TypeOrmPaymentSettlementRepository },
    { provide: DebtorCreditRepository, useClass: TypeOrmDebtorCreditRepository },
    { provide: PaymentMethodRepository, useClass: TypeOrmPaymentMethodRepository },
    { provide: CurrencyAdminRepository, useClass: TypeOrmCurrencyAdminRepository },
    PaymentAuthority,
    RegisterPaymentUseCase,
    ConfirmPaymentUseCase,
    CancelPaymentUseCase,
    ReversePaymentUseCase,
    PaymentQueriesUseCase,
    PaymentMethodsUseCase,
    CurrenciesAdminUseCase,
  ],
})
export class PaymentsModule {}
