import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Outbox } from '@/shared/application/outbox.port';
import { CircuitBreakerRegistry } from '../resilience/circuit-breaker.registry';
import { HandlerRegistry } from './handler-registry';
import { InboxMessageOrmEntity, OutboxMessageOrmEntity } from './outbox-message.orm-entity';
import { OutboxController } from './outbox.controller';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { OutboxStore } from './outbox-store';
import { PayloadCipher } from './payload-cipher';
import { TypeOrmOutbox } from './typeorm-outbox';

@Global()
@Module({
  imports: [DiscoveryModule, TypeOrmModule.forFeature([OutboxMessageOrmEntity, InboxMessageOrmEntity])],
  controllers: [OutboxController],
  providers: [PayloadCipher, OutboxStore, HandlerRegistry, OutboxDispatcher, CircuitBreakerRegistry, { provide: Outbox, useClass: TypeOrmOutbox }],
  exports: [Outbox, CircuitBreakerRegistry],
})
export class MessagingModule {}
