import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessesModule } from '../processes/processes.module';
import { UsersModule } from '../users/users.module';
import { ApprovalRequestNotifier } from './application/approval-request.notifier';
import * as L from './application/negotiation-lifecycle.use-cases';
import { RenegotiateUseCase, RenegotiationBalanceUseCase } from './application/renegotiate.use-case';
import { NEGOTIATION_SETTINGS, NegotiationSettings } from './domain/negotiation-lifecycle';
import { CancelNegotiationUseCase } from './application/cancel-negotiation.use-case';
import { CreateNegotiationUseCase } from './application/create-negotiation.use-case';
import { NegotiationQueriesUseCase } from './application/negotiation-queries.use-case';
import { NegotiationSimulatorUseCase } from './application/negotiation-simulator.use-case';
import { FinancialCalculator } from './domain/financial-calculator';
import { NegotiationPolicy } from './domain/negotiation';
import { NegotiationQueries, NegotiationRepository } from './domain/negotiation.repository';
import * as E from './infrastructure/negotiation.orm-entities';
import { TypeOrmNegotiationRepository } from './infrastructure/typeorm-negotiation.repository';
import { NegotiationsController } from './presentation/negotiations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([E.NegotiationOrmEntity, E.NegotiationProcessOrmEntity, E.NegotiationInstallmentOrmEntity]), ProcessesModule, UsersModule],
  controllers: [NegotiationsController],
  providers: [
    {
      provide: NEGOTIATION_SETTINGS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): NegotiationSettings => ({
        approvalDiscountLimitPercent: String(cfg.get('NEGOTIATION_APPROVAL_DISCOUNT_LIMIT_PERCENT', '10')),
        lateMonthlyInterestPercent: String(cfg.get('NEGOTIATION_LATE_MONTHLY_INTEREST_PERCENT', '1')),
        autoBreakEnabled: String(cfg.get('NEGOTIATION_AUTO_BREAK_ENABLED', 'false')) === 'true',
      }),
    },
    ApprovalRequestNotifier,
    L.ApprovalGuard,
    L.ApproveNegotiationUseCase,
    L.RejectNegotiationUseCase,
    L.BreakNegotiationUseCase,
    L.AutoBreakNegotiationsUseCase,
    RenegotiationBalanceUseCase,
    RenegotiateUseCase,
    { provide: FinancialCalculator, inject: [ConfigService], useFactory: (cfg: ConfigService) => new FinancialCalculator(cfg.get('MAX_PENALTY_PERCENT', 2)) },
    { provide: NegotiationPolicy, inject: [FinancialCalculator], useFactory: (c: FinancialCalculator) => new NegotiationPolicy(c) },
    TypeOrmNegotiationRepository,
    { provide: NegotiationRepository, useExisting: TypeOrmNegotiationRepository },
    { provide: NegotiationQueries, useExisting: TypeOrmNegotiationRepository },
    CreateNegotiationUseCase,
    CancelNegotiationUseCase,
    NegotiationQueriesUseCase,
    NegotiationSimulatorUseCase,
  ],
  exports: [L.AutoBreakNegotiationsUseCase],
})
export class NegotiationsModule {}
