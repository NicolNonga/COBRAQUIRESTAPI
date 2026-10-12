import { AsyncLocalStorage } from 'node:async_hooks';
import { EntityManager } from 'typeorm';

export interface TxStore {
  manager: EntityManager;
  afterCommit: Array<() => void | Promise<void>>;
}

/** Armazena a transacção corrente por contexto assíncrono. */
export const txStorage = new AsyncLocalStorage<TxStore>();
