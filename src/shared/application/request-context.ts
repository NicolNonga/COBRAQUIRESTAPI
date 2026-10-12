import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  requestId: string;
  userId?: number;
  ip?: string;
  userAgent?: string;
}

/** Contexto por pedido (correlation-id, utilizador) acessível em qualquer camada. */
export class RequestContext {
  private static readonly als = new AsyncLocalStorage<RequestContextData>();

  static run<T>(data: RequestContextData, fn: () => T): T {
    return this.als.run(data, fn);
  }
  static get(): RequestContextData | undefined {
    return this.als.getStore();
  }
  static setUser(userId: number): void {
    const s = this.als.getStore();
    if (s) s.userId = userId;
  }
}
