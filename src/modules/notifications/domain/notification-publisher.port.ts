import { NewNotification } from './notification.repository';

/**
 * Porta pública do módulo de notificações, usada por outros módulos
 * (utilizadores, processos…). Persiste na transacção corrente e só
 * emite via WebSocket depois do commit.
 */
export abstract class NotificationPublisher {
  abstract publish(items: NewNotification | NewNotification[]): Promise<void>;
}
