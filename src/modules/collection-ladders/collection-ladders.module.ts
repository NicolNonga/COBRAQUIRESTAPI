import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionPoliciesModule } from '../collection-policies/collection-policies.module';
import { ProcessesModule } from '../processes/processes.module';
import { UsersModule } from '../users/users.module';
import { PolicyQueriesUseCase, UpdatePolicyUseCase } from './application/policy.use-cases';
import * as C from './application/ladder-commands.use-cases';
import { LadderQueriesUseCase } from './application/ladder-queries.use-cases';
import { LadderTrackingQueriesUseCase, TrackLadderTasksUseCase } from './application/ladder-tracking.use-cases';
import { RunCollectionLaddersUseCase } from './application/run-ladders.use-case';
import { LadderTracking } from './domain/ladder-tracking';
import { LadderEngine, LadderRepository } from './domain/ladder.repository';
import { CollectionLadderOrmEntity, CollectionLadderStepOrmEntity } from './infrastructure/ladder.orm-entities';
import { TypeOrmLadderTracking } from './infrastructure/typeorm-ladder-tracking';
import { TypeOrmLadderEngine, TypeOrmLadderRepository } from './infrastructure/typeorm-ladder.repository';
import { LadderTasksController } from './presentation/ladder-tasks.controller';
import { CollectionLaddersController, CollectionPolicyController } from './presentation/collection-ladders.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CollectionLadderOrmEntity, CollectionLadderStepOrmEntity]), UsersModule, CollectionPoliciesModule, ProcessesModule],
  controllers: [CollectionLaddersController, CollectionPolicyController, LadderTasksController],
  providers: [
    { provide: LadderRepository, useClass: TypeOrmLadderRepository },
    { provide: LadderEngine, useClass: TypeOrmLadderEngine },
    { provide: LadderTracking, useClass: TypeOrmLadderTracking },
    TrackLadderTasksUseCase,
    LadderTrackingQueriesUseCase,
    C.CreateLadderUseCase,
    C.UpdateLadderUseCase,
    C.SetLadderActiveUseCase,
    C.ArchiveLadderUseCase,
    LadderQueriesUseCase,
    RunCollectionLaddersUseCase,
    PolicyQueriesUseCase,
    UpdatePolicyUseCase,
  ],
  exports: [RunCollectionLaddersUseCase, TrackLadderTasksUseCase],
})
export class CollectionLaddersModule {}
