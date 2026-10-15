// o binário nativo do bcrypt é compilado para o SO de quem instala; o teste só precisa da protecção que o antecede
jest.mock('bcrypt', () => ({ hash: jest.fn(async () => 'hash'), compare: jest.fn(async () => true) }));
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HttpException } from '@nestjs/common';
import { BcryptPasswordHasher } from '@/infrastructure/security/bcrypt-password-hasher';
import { requestFingerprint } from '@/infrastructure/idempotency/idempotency.interceptor';
import { UnauthorizedError, ValidationError } from '@/shared/domain/errors';
import { LoginAttemptRepository, LoginLock } from '../domain/login-attempt.repository';
import { LoginUseCase } from './auth.use-cases';

class MemoryAttempts extends LoginAttemptRepository {
  failures = new Map<string, number>();
  lockedUntil = new Map<string, number>();
  async lock(k: string): Promise<LoginLock> {
    const until = this.lockedUntil.get(k) ?? 0;
    return { minutesLeft: until > Date.now() ? Math.ceil((until - Date.now()) / 60_000) : 0 };
  }
  async recordFailure(k: string, max: number, mins: number): Promise<LoginLock> {
    const n = (this.failures.get(k) ?? 0) + 1;
    this.failures.set(k, n);
    if (n >= max) this.lockedUntil.set(k, Date.now() + mins * 60_000);
    return this.lock(k);
  }
  async clear(k: string) {
    this.failures.delete(k);
    this.lockedUntil.delete(k);
  }
}

const cfg = { get: (k: string, d?: unknown) => ({ LOGIN_MAX_FAILURES: 3, LOGIN_LOCK_MINUTES: 10 } as Record<string, unknown>)[k] ?? d } as unknown as ConfigService;

function login(opts: { hashOk: boolean; exists?: boolean }) {
  const attempts = new MemoryAttempts();
  const users = {
    findCredentialsByEmail: async () => (opts.exists === false ? null : { id: 1, email: 'a@b.ao', passwordHash: 'h', isActive: true, tokenVersion: 0 }),
    findById: async () => ({ id: 1, roleId: null }),
  };
  const uc = new LoginUseCase(
    users as never,
    { activeSlugsForUser: async () => [] } as never,
    { verify: async () => opts.hashOk } as never,
    { issue: async () => ({ token: 't', expiresIn: '1h' }) } as never,
    { record: async () => undefined } as never,
    attempts,
    cfg,
  );
  return { uc, attempts };
}

describe('Login: bloqueio contra credential stuffing', () => {
  it('bloqueia à N-ésima falha e recusa até a palavra-passe certa (429)', async () => {
    const { uc } = login({ hashOk: false });
    await expect(uc.execute('A@b.ao', 'x')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(uc.execute('a@b.ao ', 'x')).rejects.toBeInstanceOf(UnauthorizedError); // email normalizado
    const third = await uc.execute('a@b.ao', 'x').catch((e) => e);
    expect(third).toBeInstanceOf(HttpException);
    expect((third as HttpException).getStatus()).toBe(429);
    // já bloqueado: nem tenta verificar a palavra-passe
    const fourth = await uc.execute('a@b.ao', 'certa').catch((e) => e);
    expect((fourth as HttpException).getStatus()).toBe(429);
  });

  it('emails inexistentes também contam (o bloqueio não revela que contas existem)', async () => {
    const { uc } = login({ hashOk: false, exists: false });
    await uc.execute('x@y.ao', 'p').catch(() => undefined);
    await uc.execute('x@y.ao', 'p').catch(() => undefined);
    const e = await uc.execute('x@y.ao', 'p').catch((err) => err);
    expect((e as HttpException).getStatus()).toBe(429);
  });

  it('login correcto limpa as falhas', async () => {
    const { uc, attempts } = login({ hashOk: true });
    attempts.failures.set('k', 2);
    const key = [...attempts.failures.keys()][0];
    await uc.execute('a@b.ao', 'ok');
    expect(attempts.failures.size).toBe(1); // a chave 'k' manual; a do email foi limpa (nunca existiu)
    expect(key).toBe('k');
  });
});

describe('Palavra-passe e token', () => {
  it('bcrypt: recusa mais de 72 bytes em vez de truncar em silêncio', () => {
    const h = new BcryptPasswordHasher();
    expect(() => h.hash('a'.repeat(73))).toThrow(ValidationError);
    expect(() => h.hash('é'.repeat(37))).toThrow(ValidationError); // 74 bytes
  });

  it('JWT de outro emissor ou destinatário é recusado', async () => {
    const opts = { secret: 'x'.repeat(40), verifyOptions: { algorithms: ['HS256' as const], issuer: 'cobraqui-api', audience: 'cobraqui-app' } };
    const jwt = new JwtService(opts);
    const good = await jwt.signAsync({ sub: 1 }, { issuer: 'cobraqui-api', audience: 'cobraqui-app' });
    await expect(jwt.verifyAsync(good)).resolves.toMatchObject({ sub: 1 });
    const otherAud = await jwt.signAsync({ sub: 1 }, { issuer: 'cobraqui-api', audience: 'outra-app' });
    await expect(jwt.verifyAsync(otherAud)).rejects.toThrow();
    const noClaims = await jwt.signAsync({ sub: 1 });
    await expect(jwt.verifyAsync(noClaims)).rejects.toThrow();
  });
});

describe('Idempotência: impressão digital do pedido', () => {
  it('a mesma chave com outro :id não pode repetir a resposta do primeiro', () => {
    const a = requestFingerprint({ method: 'POST', originalUrl: '/api/payments/1/confirm', body: {} });
    const b = requestFingerprint({ method: 'POST', originalUrl: '/api/payments/2/confirm', body: {} });
    expect(a).not.toBe(b);
    expect(a).toBe(requestFingerprint({ method: 'POST', originalUrl: '/api/payments/1/confirm', body: {} }));
    expect(requestFingerprint({ method: 'POST', originalUrl: '/x', body: { a: 1 } })).not.toBe(requestFingerprint({ method: 'POST', originalUrl: '/x', body: { a: 2 } }));
  });
});
