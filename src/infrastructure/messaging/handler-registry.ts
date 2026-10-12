import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { MessageHandler, OUTBOX_HANDLER_META, OutboxHandlerOptions } from '@/shared/application/message-handler';

export interface RegisteredHandler {
  options: OutboxHandlerOptions;
  instance: MessageHandler;
}

/** Descobre automaticamente as classes anotadas com @OutboxHandler (Open/Closed: novo handler = nova classe). */
@Injectable()
export class HandlerRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger('Outbox');
  private readonly byType = new Map<string, RegisteredHandler[]>();

  constructor(private readonly discovery: DiscoveryService, private readonly reflector: Reflector) {}

  onApplicationBootstrap(): void {
    const names = new Set<string>();
    for (const wrapper of this.discovery.getProviders()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const options = this.reflector.get<OutboxHandlerOptions>(OUTBOX_HANDLER_META, metatype);
      if (!options) continue;
      if (names.has(options.name)) throw new Error(`Handler da outbox duplicado: ${options.name}`);
      names.add(options.name);
      for (const type of options.types) {
        this.byType.set(type, [...(this.byType.get(type) ?? []), { options, instance: instance as MessageHandler }]);
      }
    }
    this.logger.log({ handlers: [...names], types: [...this.byType.keys()] }, 'Handlers da outbox registados');
  }

  handlersFor(type: string): RegisteredHandler[] {
    return this.byType.get(type) ?? [];
  }

  /** tipos cujos handlers dependem TODOS de circuitos em `blocked` (não vale a pena reservá-los agora) */
  typesBlockedBy(blocked: Set<string>): string[] {
    if (!blocked.size) return [];
    return [...this.byType.entries()]
      .filter(([, hs]) => hs.every((h) => h.options.circuit && blocked.has(h.options.circuit)))
      .map(([type]) => type);
  }

  circuits(): Set<string> {
    return new Set([...this.byType.values()].flat().flatMap((h) => (h.options.circuit ? [h.options.circuit] : [])));
  }
}
