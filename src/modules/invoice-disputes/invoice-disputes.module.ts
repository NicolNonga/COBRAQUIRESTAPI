import { Module } from '@nestjs/common';
import * as U from './application/invoice-dispute.use-cases';
import { DisputeRegistry, DisputeRepository } from './domain/invoice-dispute';
import { TypeOrmDisputeRepository } from './infrastructure/typeorm-dispute.repository';
import { InvoiceDisputesController } from './presentation/invoice-disputes.controller';

/** Disputas de facturas. Exporta só a porta `DisputeRegistry` (usada pelo módulo de processos). */
@Module({
  controllers: [InvoiceDisputesController],
  providers: [
    TypeOrmDisputeRepository,
    { provide: DisputeRepository, useExisting: TypeOrmDisputeRepository },
    { provide: DisputeRegistry, useExisting: TypeOrmDisputeRepository },
    U.OpenDisputeUseCase,
    U.ResolveDisputeUseCase,
    U.DisputeQueriesUseCase,
  ],
  exports: [DisputeRegistry],
})
export class InvoiceDisputesModule {}
