import { SetMetadata } from '@nestjs/common';

export interface OutboxEnvelope<T = unknown> {
  id: string;
  type: string;
  payload: T;
  attempts: number;
  createdAt: Date;
  requestId: string | null;
}

/**
 * Handler de mensagens da outbox. Cada handler tem um `name` estável: é a chave
 * na tabela inbox (message_id, handler). Vários handlers podem consumir o mesmo
 * tipo (fan-out); cada um é retentado de forma independente.
 */
export interface MessageHandler<T = unknown> {
  handle(message: OutboxEnvelope<T>): Promise<void>;
}

export const OUTBOX_HANDLER_META = 'outbox:handler';

export interface OutboxHandlerOptions {
  /** nome estável e único (não mudar depois de em produção) */
  name: string;
  /** tipo(s) de mensagem consumidos */
  types: string[];
  /**
   * true  → o handler só escreve na BD: corre na mesma transacção do registo inbox (exactly-once).
   * false → efeito externo (SMTP, socket, HTTP): at-least-once; a inbox evita repetir após sucesso.
   */
  transactional?: boolean;
  /**
   * Nome do circuit breaker da dependência externa (ex.: 'smtp'). Com o circuito aberto, as mensagens
   * deste handler esperam sem gastar tentativas e o servidor externo não é martelado.
   */
  circuit?: string;
}

/** Regista a classe como handler da outbox (descoberto automaticamente no arranque). */
export const OutboxHandler = (opts: OutboxHandlerOptions) => SetMetadata(OUTBOX_HANDLER_META, opts);

/** Erro que NÃO deve ser retentado (ex.: endereço de email inválido) → vai directo para DEAD. */
export class PermanentMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentMessageError';
  }
}
