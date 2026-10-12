import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BusinessRuleError,
  ConflictError,
  DomainError,
  ForbiddenError,
  MisconfigurationError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/shared/domain/errors';
import { PG_CHECK_VIOLATION, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, pgError } from '../database/pg-errors';

const STATUS_BY_ERROR = new Map<Function, number>([
  [NotFoundError, HttpStatus.NOT_FOUND],
  [ConflictError, HttpStatus.CONFLICT],
  [BusinessRuleError, HttpStatus.UNPROCESSABLE_ENTITY],
  [ValidationError, HttpStatus.BAD_REQUEST],
  [UnauthorizedError, HttpStatus.UNAUTHORIZED],
  [ForbiddenError, HttpStatus.FORBIDDEN],
  [MisconfigurationError, HttpStatus.INTERNAL_SERVER_ERROR],
]);

/**
 * Filtro global: traduz erros de domínio e de base de dados para HTTP,
 * com corpo uniforme e sem vazar detalhes internos (stack, SQL) ao cliente.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const { status, body } = this.map(exception);

    if (status >= 500) {
      this.logger.error({ err: exception, path: req.url, requestId: req.id }, 'Erro não tratado');
      this.writeErrorFile(exception, req);
    }
    else this.logger.warn({ status, code: body.code, path: req.url, requestId: req.id }, body.message);

    res.status(status).json({ ...body, statusCode: status, requestId: req.id, timestamp: new Date().toISOString() });
  }

  /** Erros 5xx também em logs/errors.log (fora de produção), com stack, para diagnóstico rápido. */
  private writeErrorFile(e: unknown, req: Request & { id?: string }): void {
    if (process.env.NODE_ENV === 'production') return;
    try {
      const dir = join(process.cwd(), 'logs');
      mkdirSync(dir, { recursive: true });
      const err = e as { message?: string; stack?: string; code?: string; detail?: string; query?: string; constraint?: string };
      const entry = [
        `=== ${new Date().toISOString()} ${req.method} ${req.url} requestId=${req.id}`,
        `message: ${err?.message}`,
        err?.code ? `pgCode: ${err.code} ${err.detail ?? ''} ${err.constraint ?? ''}` : '',
        err?.query ? `query: ${err.query}` : '',
        err?.stack ?? String(e),
        '',
      ].filter(Boolean).join('\n');
      appendFileSync(join(dir, 'errors.log'), entry + '\n');
    } catch {
      /* nunca falhar por causa do ficheiro de log */
    }
  }

  private map(e: unknown): { status: number; body: { code: string; message: string; details?: unknown } } {
    if (e instanceof DomainError) {
      const status = [...STATUS_BY_ERROR].find(([cls]) => e instanceof cls)?.[1] ?? 400;
      return { status, body: { code: e.code, message: e.message, details: e.details } };
    }
    if (e instanceof HttpException) {
      const r = e.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? e.message);
      return {
        status: e.getStatus(),
        body: {
          code: e.getStatus() === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR',
          message: Array.isArray(message) ? 'Dados inválidos' : message,
          details: Array.isArray(message) ? message : undefined,
        },
      };
    }
    const pg = pgError(e);
    if (pg?.code === PG_UNIQUE_VIOLATION)
      return { status: 409, body: { code: 'CONFLICT', message: 'Registo duplicado', details: { constraint: pg.constraint } } };
    if (pg?.code === PG_FOREIGN_KEY_VIOLATION)
      return { status: 422, body: { code: 'REFERENCE_NOT_FOUND', message: 'Referência inexistente', details: { constraint: pg.constraint } } };
    if (pg?.code === PG_CHECK_VIOLATION)
      return { status: 422, body: { code: 'BUSINESS_RULE_VIOLATION', message: 'Valor viola uma regra de integridade', details: { constraint: pg.constraint } } };

    return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' } };
  }
}
