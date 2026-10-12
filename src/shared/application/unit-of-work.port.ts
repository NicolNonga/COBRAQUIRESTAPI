export type TxIsolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TxOptions {
  isolation?: TxIsolation;
  /** nº de tentativas em caso de falha de serialização / deadlock (40001 / 40P01) */
  retries?: number;
}

/**
 * Porta de Unidade de Trabalho (atomicidade).
 *
 * Os casos de uso dependem desta abstracção e não do TypeORM (DIP).
 * Repositórios executados dentro de `run()` participam automaticamente
 * na mesma transacção (propagação via AsyncLocalStorage).
 */
export abstract class UnitOfWork {
  abstract run<T>(work: () => Promise<T>, options?: TxOptions): Promise<T>;

  /**
   * Regista um efeito colateral (email, socket, evento) que só deve ser
   * executado DEPOIS do commit. Fora de transacção executa imediatamente.
   * Evita notificar o utilizador de algo que acabou por sofrer rollback.
   */
  abstract afterCommit(effect: () => void | Promise<void>): void;
}
