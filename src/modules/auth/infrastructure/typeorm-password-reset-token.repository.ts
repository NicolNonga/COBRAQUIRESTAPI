import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { PasswordResetTokenRepository } from '../domain/password-reset-token.repository';
import { PasswordResetTokenOrmEntity } from './password-reset-token.orm-entity';

@Injectable()
export class TypeOrmPasswordResetTokenRepository extends BaseTypeOrmRepository implements PasswordResetTokenRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async create(email: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.repo(PasswordResetTokenOrmEntity).insert({ email, tokenHash, expiresAt });
  }

  async consume(tokenHash: string): Promise<string | null> {
    const rows: Array<{ email: string }> = await this.manager.query(
      `UPDATE password_reset_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING email`,
      [tokenHash],
    );
    // TypeORM devolve [rows, count] para UPDATE em postgres
    const list = Array.isArray(rows[0]) ? (rows[0] as unknown as Array<{ email: string }>) : rows;
    return list[0]?.email ?? null;
  }

  async invalidateAllFor(email: string): Promise<void> {
    await this.manager.query(
      'UPDATE password_reset_tokens SET used_at = now() WHERE lower(email) = lower($1) AND used_at IS NULL',
      [email],
    );
  }
}
