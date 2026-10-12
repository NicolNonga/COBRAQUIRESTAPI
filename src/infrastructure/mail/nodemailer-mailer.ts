import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { PermanentMessageError } from '@/shared/application/message-handler';
import { Mailer, MailMessage } from '@/shared/application/mailer.port';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class NodemailerMailer extends Mailer {
  private readonly logger = new Logger(NodemailerMailer.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(cfg: ConfigService) {
    super();
    this.from = cfg.getOrThrow<string>('MAIL_FROM');
    this.transporter = createTransport({
      host: cfg.get<string>('SMTP_HOST'),
      port: Number(cfg.get('SMTP_PORT')),
      secure: Number(cfg.get('SMTP_PORT')) === 465,
      auth: cfg.get('SMTP_USERNAME') ? { user: cfg.get('SMTP_USERNAME'), pass: cfg.get('SMTP_PASSWORD') } : undefined,
      pool: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  /**
   * Lança erro em caso de falha (antes era engolido) para que a outbox faça retry.
   * Respostas SMTP 5xx (destinatário inválido, rejeitado) são permanentes → DEAD sem retry.
   */
  async send(m: MailMessage): Promise<void> {
    if (!EMAIL.test(m.to)) throw new PermanentMessageError(`Destinatário inválido: ${m.to}`);
    try {
      const info = await this.transporter.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
      this.logger.log({ to: m.to, subject: m.subject, messageId: info.messageId }, 'Email enviado');
    } catch (err) {
      const code = (err as { responseCode?: number }).responseCode;
      if (code && code >= 500 && code < 600) throw new PermanentMessageError(`SMTP ${code}: ${(err as Error).message}`);
      throw err; // transitório (rede, timeout, 4xx) → retry com backoff
    }
  }
}
