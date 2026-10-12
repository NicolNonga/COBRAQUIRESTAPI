import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { ProcessesModule } from '../processes/processes.module';
import { IntegrationQueriesUseCase, ResolveReviewUseCase } from './application/integration-reviews.use-cases';
import {
  GetIntegrationUseCase,
  SetIntegrationCredentialsUseCase,
  SetIntegrationStatusUseCase,
  TestIntegrationUseCase,
  UpdateIntegrationUseCase,
} from './application/integration-settings.use-cases';
import { InvoiceSyncService } from './application/invoice-sync.service';
import { RunSyncUseCase } from './application/run-sync.use-case';
import { ErpConnectorFactory } from './domain/erp-connector.port';
import {
  CollectionLedger,
  ExternalRefRepository,
  IntegrationRunRepository,
  IntegrationSettingsRepository,
  ReviewRepository,
} from './domain/integration.repository';
import { SyncLease } from './domain/sync-lease.port';
import { DefaultErpConnectorFactory } from './infrastructure/connectors/erp-connector.factory';
import { HttpTransport, NodeHttpTransport } from './infrastructure/connectors/sap-b1/http-transport';
import { CredentialVault } from './infrastructure/credential-vault';
import { PgSessionLease } from './infrastructure/pg-session-lease';
import {
  TypeOrmCollectionLedger,
  TypeOrmExternalRefRepository,
  TypeOrmIntegrationRunRepository,
  TypeOrmIntegrationSettingsRepository,
  TypeOrmReviewRepository,
} from './infrastructure/typeorm-integration.repositories';
import { IntegrationController } from './presentation/integration.controller';

/**
 * Integração com o ERP (SAP primeiro): carrega devedores e facturas e reconcilia pagamentos.
 * Um único ERP para toda a aplicação. Só leitura no ERP.
 */
@Module({
  imports: [InvoicesModule, ProcessesModule],
  controllers: [IntegrationController],
  providers: [
    { provide: IntegrationSettingsRepository, useClass: TypeOrmIntegrationSettingsRepository },
    { provide: IntegrationRunRepository, useClass: TypeOrmIntegrationRunRepository },
    { provide: ExternalRefRepository, useClass: TypeOrmExternalRefRepository },
    { provide: ReviewRepository, useClass: TypeOrmReviewRepository },
    { provide: CollectionLedger, useClass: TypeOrmCollectionLedger },
    { provide: HttpTransport, useClass: NodeHttpTransport },
    { provide: ErpConnectorFactory, useClass: DefaultErpConnectorFactory },
    { provide: SyncLease, useClass: PgSessionLease },
    CredentialVault,
    InvoiceSyncService,
    RunSyncUseCase,
    GetIntegrationUseCase,
    UpdateIntegrationUseCase,
    SetIntegrationCredentialsUseCase,
    TestIntegrationUseCase,
    SetIntegrationStatusUseCase,
    IntegrationQueriesUseCase,
    ResolveReviewUseCase,
  ],
  exports: [RunSyncUseCase],
})
export class IntegrationsModule {}
