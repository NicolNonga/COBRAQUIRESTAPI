import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IdempotencyInterceptor } from './idempotency.interceptor';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Torna o endpoint idempotente via header `Idempotency-Key`.
 * Reenvios (retry de rede, duplo clique) devolvem a mesma resposta
 * sem executar a operação financeira duas vezes.
 */
export const Idempotent = (opts: { required?: boolean } = { required: true }) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, { required: opts.required ?? true }),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: opts.required ?? true,
      description: 'UUID único por operação. Reenvios com a mesma chave devolvem a resposta original.',
    }),
  );
