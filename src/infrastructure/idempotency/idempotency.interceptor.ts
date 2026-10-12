import { createHash } from 'node:crypto';
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { DataSource } from 'typeorm';
import { IDEMPOTENT_KEY } from './idempotent.decorator';
import { IdempotencyKeyOrmEntity } from './idempotency-key.orm-entity';

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,100}$/;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const meta = this.reflector.get<{ required: boolean }>(IDEMPOTENT_KEY, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: number } }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');

    if (!key) {
      if (meta?.required) throw new BadRequestException('Header Idempotency-Key é obrigatório nesta operação');
      return next.handle();
    }
    if (!KEY_PATTERN.test(key)) throw new BadRequestException('Idempotency-Key inválida');

    const scope = `${req.user?.id ?? 'anon'}:${req.method}:${req.route?.path ?? req.path}`;
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
    const repo = this.dataSource.getRepository(IdempotencyKeyOrmEntity);

    // INSERT ... ON CONFLICT DO NOTHING: atómico — só UM pedido concorrente "ganha" a chave.
    const inserted = await repo
      .createQueryBuilder()
      .insert()
      .values({ scope, key, requestHash, status: 'IN_PROGRESS' })
      .orIgnore()
      .returning(['id'])
      .execute();

    if (inserted.raw.length === 0) {
      const existing = await repo.findOneByOrFail({ scope, key });
      if (existing.requestHash !== requestHash) {
        throw new UnprocessableEntityException('Idempotency-Key já usada com um payload diferente');
      }
      if (existing.status === 'IN_PROGRESS') {
        throw new ConflictException('Pedido com esta Idempotency-Key ainda em processamento');
      }
      res.status(existing.responseStatus ?? 200);
      res.setHeader('Idempotent-Replayed', 'true');
      return of(existing.responseBody);
    }

    const id = inserted.raw[0].id as string;
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          repo
            .update({ id }, { status: 'COMPLETED', responseStatus: res.statusCode, responseBody: (body ?? null) as never })
            .then(() => body),
        ),
      ),
      // falhou: liberta a chave para o cliente poder tentar de novo
      catchError((err) => from(repo.delete({ id })).pipe(mergeMap(() => throwError(() => err)))),
    );
  }
}
