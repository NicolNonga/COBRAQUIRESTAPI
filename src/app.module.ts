import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { envValidationSchema } from './config/env.validation';
import { HealthController } from './health.controller';
import { AuditModule } from './infrastructure/audit/audit.module';
import { RequestContextMiddleware } from './infrastructure/context/request-context.middleware';
import { DatabaseModule } from './infrastructure/database/database.module';
import { GlobalExceptionFilter } from './infrastructure/http/domain-exception.filter';
import { IdempotencyModule } from './infrastructure/idempotency/idempotency.module';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { MessagingModule } from './infrastructure/messaging/messaging.module';
import { SharedInfrastructureModule } from './infrastructure/shared-infrastructure.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogsModule } from './modules/catalogs/catalogs.module';
import { CollectionLaddersModule } from './modules/collection-ladders/collection-ladders.module';
import { CreditorAccountsModule } from './modules/creditor-accounts/creditor-accounts.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { InvoiceDisputesModule } from './modules/invoice-disputes/invoice-disputes.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DebtorsModule } from './modules/debtors/debtors.module';
import { ImportsModule } from './modules/imports/imports.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { NegotiationsModule } from './modules/negotiations/negotiations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProcessesModule } from './modules/processes/processes.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { UsersModule } from './modules/users/users.module';
import { WalletsModule } from './modules/wallets/wallets.module';

@Module({
  imports: [
    // ---- infraestrutura transversal ----
    ConfigModule.forRoot({ isGlobal: true, cache: true, validationSchema: envValidationSchema, validationOptions: { abortEarly: false } }),
    LoggingModule,
    DatabaseModule,
    AuditModule,
    IdempotencyModule,
    MessagingModule, // Outbox/Inbox + dispatcher
    SharedInfrastructureModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    MulterModule.registerAsync({
      inject: [ConfigService],
      // ficheiros em memória com limite: nunca gravamos uploads não validados em disco
      useFactory: (cfg: ConfigService) => ({ storage: memoryStorage(), limits: { fileSize: Number(cfg.get('MAX_UPLOAD_MB', 10)) * 1024 * 1024, files: 50 } }),
    }),
    // ---- módulos de domínio ----
    CatalogsModule,
    NotificationsModule,
    AccessControlModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    DebtorsModule,
    InvoicesModule,
    ProcessesModule,
    WalletsModule,
    ReportsModule,
    NegotiationsModule,
    CollectionLaddersModule,
    CreditorAccountsModule,
    PaymentsModule,
    InvoiceDisputesModule,
    DashboardModule,
    ImportsModule,
    IntegrationsModule,
    SchedulerModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
