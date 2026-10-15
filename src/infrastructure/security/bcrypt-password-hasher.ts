import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ValidationError } from '@/shared/domain/errors';
import { PasswordHasher } from '@/shared/application/password-hasher.port';

@Injectable()
export class BcryptPasswordHasher extends PasswordHasher {
  private static readonly ROUNDS = 12;
  /** o bcrypt só lê os primeiros 72 bytes: o resto seria ignorado em silêncio, por isso recusa-se */
  static readonly MAX_BYTES = 72;
  hash(plain: string): Promise<string> {
    if (Buffer.byteLength(plain, 'utf8') > BcryptPasswordHasher.MAX_BYTES) {
      throw new ValidationError(`A palavra-passe não pode ter mais de ${BcryptPasswordHasher.MAX_BYTES} bytes (cerca de ${BcryptPasswordHasher.MAX_BYTES} caracteres)`);
    }
    return bcrypt.hash(plain, BcryptPasswordHasher.ROUNDS);
  }
  verify(hash: string, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
