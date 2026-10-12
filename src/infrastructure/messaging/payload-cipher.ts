import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * AES-256-GCM para payloads sensíveis (ex.: email com palavra-passe temporária).
 * Um dump da BD ou de backups não expõe o conteúdo. Formato: base64(iv|tag|ciphertext).
 */
@Injectable()
export class PayloadCipher {
  private readonly key: Buffer;

  constructor(cfg: ConfigService) {
    this.key = Buffer.from(cfg.getOrThrow<string>('OUTBOX_ENCRYPTION_KEY'), 'hex');
    if (this.key.length !== 32) throw new Error('OUTBOX_ENCRYPTION_KEY deve ter 32 bytes (64 caracteres hex)');
  }

  encrypt(value: unknown): { v: 1; data: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { v: 1, data: Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64') };
  }

  decrypt<T>(box: { data: string }): T {
    const raw = Buffer.from(box.data, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  }
}
