import { csrfOriginGuard, parseCookies, tokenFromCookie, ttlToMs } from './session-cookie';

const run = (guard: ReturnType<typeof csrfOriginGuard>, req: Record<string, unknown>) => {
  let status = 0;
  let nexted = false;
  const res = { status: (s: number) => ((status = s), { json: () => undefined }) };
  guard(req as never, res as never, () => (nexted = true));
  return { status, nexted };
};
const ALLOWED = ['https://app.cobraqui.ao'];

describe('sessão por cookie', () => {
  it('lê o cookie e converte a duração', () => {
    expect(parseCookies('a=1; cobraqui_token=abc%20d; x=y').cobraqui_token).toBe('abc d');
    expect(tokenFromCookie({ headers: {} })).toBeNull();
    expect(ttlToMs('1h')).toBe(3_600_000);
    expect(ttlToMs('900')).toBe(900_000);
  });

  it('CSRF: bloqueia POST com cookie vindo de outra origem', () => {
    const guard = csrfOriginGuard(ALLOWED);
    const cookie = 'cobraqui_token=t';
    expect(run(guard, { method: 'POST', headers: { cookie, origin: 'https://evil.example' } }).status).toBe(403);
    expect(run(guard, { method: 'POST', headers: { cookie } }).status).toBe(403);
    expect(run(guard, { method: 'POST', headers: { cookie, origin: 'https://app.cobraqui.ao' } }).nexted).toBe(true);
  });

  it('CSRF: GET, Authorization e pedidos sem cookie passam', () => {
    const guard = csrfOriginGuard(ALLOWED);
    expect(run(guard, { method: 'GET', headers: { cookie: 'cobraqui_token=t', origin: 'https://evil.example' } }).nexted).toBe(true);
    expect(run(guard, { method: 'POST', headers: { authorization: 'Bearer x', cookie: 'cobraqui_token=t' } }).nexted).toBe(true);
    expect(run(guard, { method: 'POST', headers: {} }).nexted).toBe(true);
  });
});
