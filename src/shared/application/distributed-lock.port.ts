/**
 * Lock distribuído para jobs agendados: garante que, com N réplicas da API,
 * apenas uma executa o job de cada vez (implementado com pg advisory locks).
 */
export abstract class DistributedLock {
  /** Executa `work` se conseguir o lock; caso contrário devolve `{ acquired: false }`. */
  abstract tryWithLock<T>(key: string, work: () => Promise<T>): Promise<{ acquired: boolean; result?: T }>;
}
