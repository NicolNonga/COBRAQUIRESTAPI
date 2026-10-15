export interface LoginLock {
  /** minutos que faltam para poder tentar de novo (0 = não está bloqueado) */
  minutesLeft: number;
}

/** Falhas de login por email. Fora da transacção do pedido: a falha tem de ficar registada mesmo que o pedido termine em erro. */
export abstract class LoginAttemptRepository {
  abstract lock(emailKey: string): Promise<LoginLock>;
  /** regista uma falha; devolve o bloqueio resultante (se atingiu o limite) */
  abstract recordFailure(emailKey: string, maxFailures: number, lockMinutes: number): Promise<LoginLock>;
  abstract clear(emailKey: string): Promise<void>;
}
