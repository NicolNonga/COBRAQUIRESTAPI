import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessRuleError } from '@/shared/domain/errors';

/**
 * Credenciais do ERP cifradas em repouso (AES-256-GCM), com chave própria (INTEGRATIONS_ENCRYPTION_KEY).
 * Um dump da BD não expõe a palavra-passe do SAP. Formato: "v1:" + base64(iv | tag | cifra).
 * A chave é opcional no arranque: sem ela a API sobe, mas não se gravam nem usam credenciais.
 */
@Injectable()
export class CredentialVault {
  private readonly key: Buffer | null;

  constructor(cfg: ConfigService) {
    const hex = cfg.get<string>('INTEGRATIONS_ENCRYPTION_KEY');
    this.key = hex ? Buffer.from(hex, 'hex') : null;
    if (this.key && this.key.length !== 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY deve ter 32 bytes (64 caracteres hex)');
  }

  private requireKey(): Buffer {
    if (!this.key) throw new BusinessRuleError('O servidor não tem a chave de cifra das integrações (INTEGRATIONS_ENCRYPTION_KEY). Peça ao administrador do sistema para a configurar.');
    return this.key;
  }

  encrypt(credentials: Record<string, string>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.requireKey(), iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
  }

  decrypt(box: string): Record<string, string> {
    if (!box.startsWith('v1:')) throw new Error('Formato de credenciais desconhecido');
    const raw = Buffer.from(box.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  }
}
