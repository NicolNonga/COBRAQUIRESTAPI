import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreaker, CircuitSnapshot } from './circuit-breaker';

/** Um circuito por dependência externa (nome estável, ex.: 'smtp'), criado na primeira utilização. */
@Injectable()
export class CircuitBreakerRegistry {
  private readonly logger = new Logger('CircuitBreaker');
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly maxOpenMs: number;

  constructor(cfg: ConfigService) {
    this.failureThreshold = Number(cfg.get('CIRCUIT_FAILURE_THRESHOLD', 5));
    this.openMs = Number(cfg.get('CIRCUIT_OPEN_SECONDS', 30)) * 1000;
    this.maxOpenMs = Number(cfg.get('CIRCUIT_MAX_OPEN_SECONDS', 600)) * 1000;
  }

  get(name: string): CircuitBreaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = new CircuitBreaker(name, {
        failureThreshold: this.failureThreshold,
        openMs: this.openMs,
        maxOpenMs: this.maxOpenMs,
        onStateChange: (n, from, to, info) => {
          const log = { circuit: n, from, to, retryAt: info.retryAt, lastError: info.lastError, openedCount: info.openedCount };
          if (to === 'OPEN') this.logger.error({ ...log, alert: 'CIRCUIT_OPEN' }, `Circuito ${n} ABERTO: dependência indisponível`);
          else if (to === 'CLOSED') this.logger.log(log, `Circuito ${n} fechado: dependência recuperada`);
          else this.logger.warn(log, `Circuito ${n} em teste (half-open)`);
        },
      });
      this.breakers.set(name, b);
    }
    return b;
  }

  /** nomes cujo circuito está a bloquear agora (para não reservar mensagens que iam falhar) */
  blocking(names: Iterable<string>): Set<string> {
    return new Set([...names].filter((n) => this.breakers.get(n)?.isBlocking()));
  }

  snapshots(): CircuitSnapshot[] {
    return [...this.breakers.values()].map((b) => b.snapshot());
  }
}
