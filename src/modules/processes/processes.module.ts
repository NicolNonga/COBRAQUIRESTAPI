import { CollectionPoliciesModule } from '../collection-policies/collection-policies.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceDisputesModule } from '../invoice-disputes/invoice-disputes.module';
import { UsersModule } from '../users/users.module';
import * as A from './application/assignment.use-cases';
import { ContactHistoryUseCase } from './application/contact-history.use-case';
import { CreateContactUseCase } from './application/create-contact.use-case';
import { GenerateCollectionProcessesUseCase } from './application/generate-collection-processes.use-case';
import { ProcessQueriesUseCase } from './application/process-queries.use-case';
import { RemoveInvoicesFromProcessUseCase } from './application/remove-invoices-from-process.use-case';
import { ReturnTemporaryTransfersUseCase, TransferProcessesUseCase } from './application/transfer-processes.use-case';
import { ContactRepository, ProcessCommandRepository, ProcessLookup, ProcessQueries } from './domain/process.repository';
import * as E from './infrastructure/process.orm-entities';
import { TypeOrmContactRepository } from './infrastructure/typeorm-contact.repository';
import { TypeOrmProcessRepository } from './infrastructure/typeorm-process.repository';
import { ContactsController, ProcessesController } from './presentation/processes.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([E.ProcessOrmEntity, E.ProcessInvoiceOrmEntity, E.ProcessAssignmentOrmEntity, E.ProcessTransferOrmEntity, E.ContactOrmEntity]),
    UsersModule,
    CollectionPoliciesModule,
    InvoiceDisputesModule,
  ],
  controllers: [ProcessesController, ContactsController],
  providers: [
    TypeOrmProcessRepository,
    { provide: ProcessCommandRepository, useExisting: TypeOrmProcessRepository },
    { provide: ProcessLookup, useExisting: TypeOrmProcessRepository },
    { provide: ProcessQueries, useExisting: TypeOrmProcessRepository },
    { provide: ContactRepository, useClass: TypeOrmContactRepository },
    GenerateCollectionProcessesUseCase,
    A.AssignWalletProcessesUseCase,
    A.AutoAssignProcessesUseCase,
    A.AssignProcessToUserUseCase,
    TransferProcessesUseCase,
    ReturnTemporaryTransfersUseCase,
    RemoveInvoicesFromProcessUseCase,
    CreateContactUseCase,
    ContactHistoryUseCase,
    ProcessQueriesUseCase,
  ],
  exports: [ProcessLookup, ProcessCommandRepository, GenerateCollectionProcessesUseCase, A.AssignWalletProcessesUseCase, ReturnTemporaryTransfersUseCase],
})
export class ProcessesModule {}
