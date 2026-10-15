import { createHash, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermissionRepository } from '@/modules/access-control/domain/access-control.repository';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { EmailSendPayload, MessageTypes, Outbox } from '@/shared/application/outbox.port';
import { PasswordHasher } from '@/shared/application/password-hasher.port';
import { RequestContext } from '@/shared/application/request-context';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, UnauthorizedError } from '@/shared/domain/errors';
import { LoginAttemptRepository } from '../domain/login-attempt.repository';
import { PasswordResetTokenRepository } from '../domain/password-reset-token.repository';
import { TokenIssuer } from './token-issuer.port';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
// hash fictício para igualar o tempo de resposta quando o email não existe (anti user-enumeration)
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO5RZ3Qj5h8ZHlZr0yW0v8tYH6rU2J6a2';

@Injectable()
export class LoginUseCase {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly users: UserRepository,
    private readonly perms: PermissionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly audit: AuditTrail,
    private readonly attempts: LoginAttemptRepository,
    private readonly cfg: ConfigService,
  ) {}

  async execute(email: string, password: string) {
    const key = sha256(email.trim().toLowerCase());
    const locked = await this.attempts.lock(key);
    if (locked.minutesLeft > 0) {
      this.logger.warn({ ip: RequestContext.get()?.ip }, 'Login recusado: conta temporariamente bloqueada');
      throw this.tooMany(locked.minutesLeft);
    }
    const creds = await this.users.findCredentialsByEmail(email);
    const valid = await this.hasher.verify(creds?.passwordHash ?? DUMMY_HASH, password);
    if (!creds || !valid || !creds.isActive) {
      this.logger.warn({ ip: RequestContext.get()?.ip }, 'Tentativa de login falhada');
      // conta-se também para emails que não existem: o bloqueio não revela que contas existem
      const after = await this.attempts.recordFailure(key, this.cfg.get<number>('LOGIN_MAX_FAILURES', 5), this.cfg.get<number>('LOGIN_LOCK_MINUTES', 15));
      if (after.minutesLeft > 0) throw this.tooMany(after.minutesLeft);
      throw new UnauthorizedError('Email ou palavra-passe inválidos'); // mesma mensagem para todos os casos
    }
    await this.attempts.clear(key);
    const user = await this.users.findById(creds.id);
    const permissions = await this.perms.activeSlugsForUser(creds.id, user?.roleId && user.role?.isActive ? user.roleId : null);
    const access = await this.tokens.issue({ sub: creds.id, tv: creds.tokenVersion });
    RequestContext.setUser(creds.id);
    await this.audit.record({ action: 'USER_LOGIN', entity: 'user', entityId: creds.id });
    return { token: { type: 'bearer', ...access }, user: { ...user, permissions } };
  }

  private tooMany(minutes: number): HttpException {
    return new HttpException(
      { code: 'TOO_MANY_ATTEMPTS', message: `Demasiadas tentativas falhadas. Tente novamente dentro de ${minutes} minuto(s) ou recupere a palavra-passe.` },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class LogoutUseCase {
  constructor(private readonly users: UserRepository, private readonly audit: AuditTrail, private readonly uow: UnitOfWork) {}
  execute(userId: number) {
    return this.uow.run(async () => {
      await this.users.bumpTokenVersion(userId); // invalida TODOS os JWT emitidos
      await this.audit.record({ action: 'USER_LOGOUT', entity: 'user', entityId: userId });
    });
  }
}

@Injectable()
export class RequestPasswordResetUseCase {
  private static readonly TTL_MIN = 30;
  constructor(
    private readonly users: UserRepository,
    private readonly resetTokens: PasswordResetTokenRepository,
    private readonly outbox: Outbox,
    private readonly cfg: ConfigService,
    private readonly uow: UnitOfWork,
  ) {}

  /** Resposta sempre igual, exista ou não o email (não revela utilizadores). */
  async execute(email: string): Promise<void> {
    const creds = await this.users.findCredentialsByEmail(email);
    if (!creds || !creds.isActive) return;
    const token = randomBytes(32).toString('hex');
    await this.uow.run(async () => {
      await this.resetTokens.invalidateAllFor(creds.email); // só o último link é válido
      await this.resetTokens.create(creds.email, sha256(token), new Date(Date.now() + RequestPasswordResetUseCase.TTL_MIN * 60_000));
      await this.outbox.enqueue<EmailSendPayload>({
        type: MessageTypes.EMAIL_SEND,
        sensitive: true, // o link contém o token de reset
        maxAttempts: 6, // após ~30 min o link expira: não vale a pena insistir mais
        payload: {
          to: creds.email,
          subject: 'Recuperar a palavra-passe',
          text: `Clique no link para definir uma nova palavra-passe (válido ${RequestPasswordResetUseCase.TTL_MIN} min): ${this.cfg.get('LINK_FORGET_PASSWORD')}${token}`,
        },
      });
    });
  }
}

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly resetTokens: PasswordResetTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(token: string, newPassword: string): Promise<void> {
    const hash = await this.hasher.hash(newPassword);
    await this.uow.run(async () => {
      const email = await this.resetTokens.consume(sha256(token));
      if (!email) throw new BusinessRuleError('Token inválido ou expirado');
      if (!(await this.users.setPasswordByEmail(email, hash))) throw new BusinessRuleError('Token inválido ou expirado');
      await this.audit.record({ action: 'USER_PASSWORD_RESET', entity: 'user', payload: { email } });
    });
  }
}

@Injectable()
export class GetMeUseCase {
  constructor(private readonly users: UserRepository) {}
  async execute(userId: number) {
    const u = await this.users.findDetailedWithPermissions(userId);
    if (!u) throw new UnauthorizedError('Sessão inválida');
    return u;
  }
}
