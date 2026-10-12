import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mailer } from '@/shared/application/mailer.port';
import { MessageHandler, OutboxEnvelope, OutboxHandler, PermanentMessageError } from '@/shared/application/message-handler';
import { DebtorMessagePayload, MessageTypes } from '@/shared/application/outbox.port';

/**
 * Mensagens ao devedor geradas pela régua de cobrança — passam SEMPRE pela outbox.
 *
 * DEBTOR_MESSAGES_MODE:
 *   - "log"  (por omissão, testes): não envia nada; escreve a mensagem completa nos logs do sistema;
 *   - "send": emails seguem pelo SMTP configurado. SMS ainda não tem fornecedor → continua só nos logs.
 */
@Injectable()
@OutboxHandler({ name: 'debtor.email-sender', types: [MessageTypes.DEBTOR_EMAIL], transactional: false, circuit: 'smtp' })
export class DebtorEmailHandler implements MessageHandler<DebtorMessagePayload> {
  private readonly logger = new Logger('MensagensDevedor');
  constructor(private readonly mailer: Mailer, private readonly cfg: ConfigService) {}

  async handle(m: OutboxEnvelope<DebtorMessagePayload>): Promise<void> {
    const p = m.payload;
    if (!p.to) throw new PermanentMessageError(`Devedor ${p.debtorName} sem email`);
    if (this.cfg.get('DEBTOR_MESSAGES_MODE', 'log') !== 'send') {
      this.logger.log(
        { canal: 'EMAIL', modo: 'teste (não enviado)', para: p.to, devedor: p.debtorName, processo: p.processId, assunto: p.subject, texto: p.text },
        `[TESTE] Email ao devedor ${p.debtorName} <${p.to}>: ${p.subject ?? ''}`,
      );
      return;
    }
    await this.mailer.send({ to: p.to, subject: p.subject ?? 'Aviso de cobrança', text: p.text });
    this.logger.log({ canal: 'EMAIL', para: p.to, devedor: p.debtorName, processo: p.processId }, 'Email enviado ao devedor');
  }
}

@Injectable()
@OutboxHandler({ name: 'debtor.sms-sender', types: [MessageTypes.DEBTOR_SMS], transactional: false })
export class DebtorSmsHandler implements MessageHandler<DebtorMessagePayload> {
  private readonly logger = new Logger('MensagensDevedor');

  async handle(m: OutboxEnvelope<DebtorMessagePayload>): Promise<void> {
    const p = m.payload;
    if (!p.to) throw new PermanentMessageError(`Devedor ${p.debtorName} sem telefone`);
    // ainda sem fornecedor de SMS: fica registado nos logs (e na fila de envios como entregue)
    this.logger.log(
      { canal: 'SMS', modo: 'sem fornecedor (não enviado)', para: p.to, devedor: p.debtorName, processo: p.processId, texto: p.text },
      `[TESTE] SMS ao devedor ${p.debtorName} (${p.to}): ${p.text}`,
    );
  }
}
