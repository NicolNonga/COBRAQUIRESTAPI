/**
 * Circuit breaker (por dependência externa: SMTP, HTTP…), por instância.
 *
 *  CLOSED    → chamadas passam; N falhas seguidas → OPEN
 *  OPEN      → chamadas recusadas de imediato (CircuitOpenError) durante `openMs`
 *  HALF_OPEN → passa UMA chamada de teste: sucesso → CLOSED; falha → OPEN com espera a dobrar (até `maxOpenMs`)
 *
 * Objectivo: quando o SMTP está em baixo não martelar o servidor nem gastar as tentativas da outbox;
 * as mensagens ficam à espera e saem quando o serviço volta.
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
  maxOpenMs: number;
  now?: () => number;
  onStateChange?: (name: string, from: CircuitState, to: CircuitState, info: CircuitSnapshot) => void;
}

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  /** quando volta a deixar passar uma chamada de teste (só OPEN) */
  retryAt: Date | null;
  lastError: string | null;
  openedCount: number;
}

export class CircuitOpenError extends Error {
  constructor(readonly circuit: string, readonly retryAt: Date) {
    super(`Circuito '${circuit}' aberto até ${retryAt.toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private currentOpenMs: number;
  private trialInFlight = false;
  private lastError: string | null = null;
  private openedCount = 0;
  private readonly now: () => number;

  constructor(readonly name: string, private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? Date.now;
    this.currentOpenMs = opts.openMs;
  }

  snapshot(): CircuitSnapshot {
    this.refresh();
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.failures,
      retryAt: this.state === 'OPEN' ? new Date(this.openedAt + this.currentOpenMs) : null,
      lastError: this.lastError,
      openedCount: this.openedCount,
    };
  }

  /** true enquanto não se deve tentar (OPEN dentro da janela, ou HALF_OPEN com teste em curso) */
  isBlocking(): boolean {
    this.refresh();
    return this.state === 'OPEN' || (this.state === 'HALF_OPEN' && this.trialInFlight);
  }

  /**
   * Executa `fn` através do circuito. `countsAsFailure(err)` decide se o erro é da dependência
   * (timeout, ligação recusada…) ou do pedido (ex.: endereço inválido) — este não abre o circuito.
   */
  async execute<T>(fn: () => Promise<T>, countsAsFailure: (err: unknown) => boolean = () => true): Promise<T> {
    this.refresh();
    if (this.state === 'OPEN') throw new CircuitOpenError(this.name, new Date(this.openedAt + this.currentOpenMs));
    const isTrial = this.state === 'HALF_OPEN';
    if (isTrial) {
      if (this.trialInFlight) throw new CircuitOpenError(this.name, new Date(this.now() + 1_000));
      this.trialInFlight = true;
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (countsAsFailure(err)) this.onFailure(err);
      else this.onSuccess(); // a dependência respondeu: o problema é do pedido
      throw err;
    } finally {
      if (isTrial) this.trialInFlight = false;
    }
  }

  private refresh(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.currentOpenMs) this.transition('HALF_OPEN');
  }

  private onSuccess(): void {
    this.failures = 0;
    this.currentOpenMs = this.opts.openMs;
    if (this.state !== 'CLOSED') this.transition('CLOSED');
  }

  private onFailure(err: unknown): void {
    this.lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (this.state === 'HALF_OPEN') {
      this.currentOpenMs = Math.min(this.currentOpenMs * 2, this.opts.maxOpenMs);
      return this.open();
    }
    this.failures += 1;
    if (this.failures >= this.opts.failureThreshold) this.open();
  }

  private open(): void {
    this.openedAt = this.now();
    this.openedCount += 1;
    this.transition('OPEN');
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    this.opts.onStateChange?.(this.name, from, to, {
      name: this.name,
      state: to,
      consecutiveFailures: this.failures,
      retryAt: to === 'OPEN' ? new Date(this.openedAt + this.currentOpenMs) : null,
      lastError: this.lastError,
      openedCount: this.openedCount,
    });
  }
}
