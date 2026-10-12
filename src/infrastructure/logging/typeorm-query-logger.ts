import { Logger as NestLogger } from '@nestjs/common';
import { Logger as TypeOrmLogger } from 'typeorm';

/** Encaminha logs do TypeORM para o logger estruturado (pino) — com destaque para queries lentas. */
export class TypeOrmQueryLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('Database');

  logQuery(): void {
    /* queries normais não são registadas (ruído e potencial PII) */
  }
  logQueryError(error: string | Error, query: string): void {
    this.logger.error({ err: error, query: this.truncate(query) }, 'Erro de query');
  }
  logQuerySlow(time: number, query: string): void {
    this.logger.warn({ durationMs: time, query: this.truncate(query) }, 'Query lenta');
  }
  logSchemaBuild(message: string): void {
    this.logger.log(message);
  }
  logMigration(message: string): void {
    this.logger.log(message);
  }
  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') this.logger.warn(message);
    else this.logger.log(message);
  }
  private truncate(q: string): string {
    return q.length > 2000 ? `${q.slice(0, 2000)}…` : q;
  }
}
