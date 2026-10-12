import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { DistributedLock } from '@/shared/application/distributed-lock.port';
import { buildDataSourceOptions } from './typeorm-config';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';
import { PgAdvisoryLock } from '../locking/pg-advisory-lock';
import { TypeOrmQueryLogger } from '../logging/typeorm-query-logger';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        ...buildDataSourceOptions(cfg),
        autoLoadEntities: true,
        logger: new TypeOrmQueryLogger(),
        logging: ['error', 'warn'],
      }),
    }),
  ],
  providers: [
    { provide: UnitOfWork, useClass: TypeOrmUnitOfWork },
    { provide: DistributedLock, useClass: PgAdvisoryLock },
  ],
  exports: [UnitOfWork, DistributedLock],
})
export class DatabaseModule {}
