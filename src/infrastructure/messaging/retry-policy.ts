/**
 * Backoff exponencial com "full jitter" (evita que todas as mensagens falhadas
 * voltem a bater no SMTP ao mesmo tempo — thundering herd).
 *   tentativa 1 → até 30s, 2 → 1 min, 3 → 2 min … limitado a 1h.
 */
export class RetryPolicy {
  constructor(private readonly baseMs = 30_000, private readonly capMs = 3_600_000) {}

  nextAttemptAt(attempt: number, now = Date.now()): Date {
    const exp = Math.min(this.capMs, this.baseMs * 2 ** Math.max(0, attempt - 1));
    const delay = Math.max(1_000, Math.floor(Math.random() * exp));
    return new Date(now + delay);
  }
}
