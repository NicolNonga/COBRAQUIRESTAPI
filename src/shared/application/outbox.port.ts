/**
 * Porta da Outbox transaccional.
 *
 * `enqueue` grava o evento na MESMA transacção da operação de negócio corrente
 * (UnitOfWork). Se a transacção fizer rollback, o evento desaparece com ela;
 * se fizer commit, o evento será entregue pelo dispatcher — com retry — mesmo
 * que o processo caia logo a seguir.
 */
export interface OutboxMessageInput<T = unknown> {
  type: string;
  payload: T;
  /** chave de deduplicação: o mesmo evento lógico nunca é enfileirado duas vezes */
  dedupKey?: string;
  /** cifra o payload em repouso e apaga-o depois de entregue (ex.: emails com palavras-passe) */
  sensitive?: boolean;
  /** entrega diferida */
  availableAt?: Date;
  maxAttempts?: number;
}

export abstract class Outbox {
  abstract enqueue<T>(message: OutboxMessageInput<T>): Promise<void>;
  abstract enqueueMany<T>(messages: OutboxMessageInput<T>[]): Promise<void>;
}

/** Tipos de mensagem conhecidos (contrato entre produtores e handlers). */
export const MessageTypes = {
  EMAIL_SEND: 'email.send',
  NOTIFICATION_REQUESTED: 'notification.requested',
  NOTIFICATION_CREATED: 'notification.created',
  /** mensagem ao devedor (régua de cobrança) */
  DEBTOR_EMAIL: 'debtor.email.send',
  DEBTOR_SMS: 'debtor.sms.send',
} as const;

/** Mensagem dirigida a um devedor (email ou SMS), com contexto para os logs/auditoria. */
export interface DebtorMessagePayload {
  debtorId: number;
  debtorName: string;
  processId: number;
  stepId: number;
  /** email ou telefone */
  to: string;
  subject?: string;
  text: string;
}

export interface EmailSendPayload {
  to: string;
  subject: string;
  text: string;
}

/** Pedido de notificação (o que os casos de uso emitem). */
export interface NotificationRequestedPayload {
  items: Array<{
    userId: number;
    type: string;
    title?: string;
    message: string;
    data?: Record<string, unknown>;
    actionUrl?: string;
    priority?: 'low' | 'medium' | 'high';
  }>;
}

export interface NotificationCreatedPayload {
  notificationIds: string[];
}
