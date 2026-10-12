import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CollectionLaddersModule } from '../collection-ladders/collection-ladders.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { NegotiationsModule } from '../negotiations/negotiations.module';
import { ProcessesModule } from '../processes/processes.module';
import { CollectionJobsService } from './collection-jobs.service';

@Module({
  imports: [ScheduleModule.forRoot(), InvoicesModule, ProcessesModule, CollectionLaddersModule, NegotiationsModule, IntegrationsModule],
  providers: [CollectionJobsService],
})
export class SchedulerModule {}
