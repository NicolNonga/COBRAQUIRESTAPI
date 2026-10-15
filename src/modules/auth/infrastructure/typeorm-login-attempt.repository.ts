import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoginAttemptRepository, LoginLock } from '../domain/login-attempt.repository';

const minutesLeft = (lockedUntil: Date | null): number =>
  lockedUntil && lockedUntil.getTime() > Date.now() ? Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000)) : 0;

@Injectable()
export class TypeOrmLoginAttemptRepository extends LoginAttemptRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {
    super();
  }

  async lock(emailKey: string): Promise<LoginLock> {
    const [row]: Array<{ locked_until: Date | null }> = await this.ds.query('SELECT locked_until FROM login_attempts WHERE key_hash = $1', [emailKey]);
    return { minutesLeft: minutesLeft(row?.locked_until ?? null) };
  }

  async recordFailure(emailKey: string, maxFailures: number, lockMinutes: number): Promise<LoginLock> {
    // as falhas contam-se numa janela do tamanho do bloqueio; passada a janela (ou o bloqueio) recomeça-se em 1
    const fresh = `(login_attempts.last_failure_at < now() - make_interval(mins => $3)
                    OR (login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= now()))`;
    const next = `(CASE WHEN ${fresh} THEN 1 ELSE login_attempts.failures + 1 END)`;
    const [row]: Array<{ locked_until: Date | null }> = await this.ds.query(
      `INSERT INTO login_attempts (key_hash, failures, last_failure_at) VALUES ($1, 1, now())
       ON CONFLICT (key_hash) DO UPDATE SET
         failures = ${next},
         last_failure_at = now(),
         locked_until = CASE WHEN ${next} >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END
       RETURNING locked_until`,
      [emailKey, maxFailures, lockMinutes],
    );
    // limpeza ocasional: emails inventados por um atacante não podem fazer a tabela crescer sem fim
    if (Math.random() < 0.02) await this.ds.query("DELETE FROM login_attempts WHERE last_failure_at < now() - interval '1 day'");
    return { minutesLeft: minutesLeft(row?.locked_until ?? null) };
  }

  async clear(emailKey: string): Promise<void> {
    await this.ds.query('DELETE FROM login_attempts WHERE key_hash = $1', [emailKey]);
  }
}
