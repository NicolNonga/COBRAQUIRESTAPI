import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordHasher } from '@/shared/application/password-hasher.port';

@Injectable()
export class BcryptPasswordHasher extends PasswordHasher {
  private static readonly ROUNDS = 12;
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BcryptPasswordHasher.ROUNDS);
  }
  verify(hash: string, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
