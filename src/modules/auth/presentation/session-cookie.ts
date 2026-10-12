import type { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

/**
 * Sessão em cookie HttpOnly: o JavaScript da página (e portanto qualquer XSS) não consegue ler o token.
 * O cabeçalho `Authorization: Bearer` continua aceite (Swagger, integrações, testes).
 */
export const SESSION_COOKIE = 'cobraqui_token';

export const parseCookies = (header?: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* cookie malformado: ignora */
    }
  }
  return out;
};

export const tokenFromCookie = (req: { headers: { cookie?: string } }): string | null => parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
export const ttlToMs = (v: string): number => {
  const m = /^(\d+)\s*([smhd])?$/i.exec(String(v).trim());
  if (!m) return UNIT_MS.h;
  return Number(m[1]) * UNIT_MS[(m[2]?.toLowerCase() ?? 's') as keyof typeof UNIT_MS];
};

type Cfg = Pick<ConfigService, 'get'>;
const baseOptions = (cfg: Cfg) => ({
  httpOnly: true,
  secure: String(cfg.get('AUTH_COOKIE_SECURE')) === 'true',
  sameSite: String(cfg.get('AUTH_COOKIE_SAMESITE') ?? 'lax').toLowerCase() as 'lax' | 'strict' | 'none',
  domain: cfg.get<string>('AUTH_COOKIE_DOMAIN') || undefined,
  path: '/',
});

export const setSessionCookie = (res: Response, token: string, expiresIn: string, cfg: Cfg): void => {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(cfg), maxAge: ttlToMs(expiresIn) });
};
export const clearSessionCookie = (res: Response, cfg: Cfg): void => {
  res.clearCookie(SESSION_COOKIE, baseOptions(cfg));
};

/** Origens autorizadas (CORS_ORIGINS). `null` = qualquer (só admitido fora de produção). */
export const allowedOrigins = (cfg: Cfg): string[] | null => {
  const raw = String(cfg.get('CORS_ORIGINS') ?? '*').trim();
  return raw === '*' ? null : raw.split(',').map((o) => o.trim()).filter(Boolean);
};

/**
 * Defesa contra CSRF para pedidos que alteram dados e se autenticam só pelo cookie:
 * a origem (Origin/Referer) tem de ser uma das autorizadas. Pedidos com `Authorization` não usam o cookie e passam.
 */
export const csrfOriginGuard = (allowed: string[] | null) => (req: Request, res: Response, next: NextFunction): void => {
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (safe || allowed === null || req.headers.authorization || !tokenFromCookie(req)) return next();
  let origin = req.headers.origin;
  if (!origin && req.headers.referer) {
    try {
      origin = new URL(req.headers.referer).origin;
    } catch {
      /* referer inválido */
    }
  }
  if (origin && allowed.includes(origin)) return next();
  res.status(403).json({ statusCode: 403, code: 'FORBIDDEN_ORIGIN', message: 'Origem do pedido não autorizada' });
};
