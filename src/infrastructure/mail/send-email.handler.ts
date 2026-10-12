import { Injectable } from '@nestjs/common';
import { MessageHandler, OutboxEnvelope, OutboxHandler } from '@/shared/application/message-handler';
import { Mailer } from '@/shared/application/mailer.port';
import { EmailSendPayload, MessageTypes } from '@/shared/application/outbox.port';

/**
 * Consome `email.send` da outbox. Falhas transitórias (SMTP em baixo) são retentadas pelo dispatcher;
 * falhas seguidas abrem o circuito 'smtp' e os emails esperam sem gastar tentativas.
 */
@Injectable()
@OutboxHandler({ name: 'mail.smtp-sender', types: [MessageTypes.EMAIL_SEND], transactional: false, circuit: 'smtp' })
export class SendEmailHandler implements MessageHandler<EmailSendPayload> {
  constructor(private readonly mailer: Mailer) {}

  handle(message: OutboxEnvelope<EmailSendPayload>): Promise<void> {
    return this.mailer.send(message.payload);
  }
}
