/**
 * Exclusão mútua da sincronização entre réplicas da API, SEM transacção à volta:
 * a sincronização grava página a página (cada página na sua transacção), por isso não pode usar
 * o DistributedLock dos jobs, que corre o trabalho todo dentro de uma única transacção.
 */
export abstract class SyncLease {
  /** devolve a função que liberta o lock, ou null se outra instância já o tem */
  abstract tryAcquire(key: string): Promise<(() => Promise<void>) | null>;
}
