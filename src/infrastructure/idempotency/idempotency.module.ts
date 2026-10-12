import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKeyOrmEntity } from './idempotency-key.orm-entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKeyOrmEntity])],
  providers: [IdempotencyInterceptor],
  exports: [IdempotencyInterceptor],
})
export class IdempotencyModule {}
