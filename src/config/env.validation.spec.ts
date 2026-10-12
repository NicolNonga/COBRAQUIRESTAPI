import { envValidationSchema } from './env.validation';

const base = { DB_HOST: 'h', DB_USER: 'u', DB_DATABASE: 'd', JWT_SECRET: 'x'.repeat(32), SMTP_HOST: 's', MAIL_FROM: 'a@b.co', LINK_FORGET_PASSWORD: 'https://a.co/r?t=', OUTBOX_ENCRYPTION_KEY: 'a'.repeat(64) };
const check = (env: object) => envValidationSchema.validate({ ...base, ...env }, { abortEarly: false });

describe('validação do ambiente (segurança)', () => {
  it('desenvolvimento: CORS aberto por omissão, cookie sem Secure', () => {
    const r = check({});
    expect(r.error).toBeUndefined();
    expect(r.value.CORS_ORIGINS).toBe('*');
    expect(r.value.AUTH_COOKIE_SECURE).toBe(false);
    expect(r.value.DB_SSL_REJECT_UNAUTHORIZED).toBe(true);
  });
  it('produção: recusa CORS "*" ou em falta', () => {
    expect(check({ NODE_ENV: 'production', CORS_ORIGINS: '*' }).error).toBeDefined();
    expect(check({ NODE_ENV: 'production' }).error).toBeDefined();
  });
  it('produção: com origens listadas, cookie Secure por omissão', () => {
    const r = check({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.cobraqui.ao' });
    expect(r.error).toBeUndefined();
    expect(r.value.AUTH_COOKIE_SECURE).toBe(true);
  });
  it('produção: não deixa desligar o Secure do cookie', () => {
    expect(check({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.cobraqui.ao', AUTH_COOKIE_SECURE: false }).error).toBeDefined();
  });
});
