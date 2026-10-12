export interface AccessTokenPayload {
  sub: number;
  tv: number; // token version
}

export abstract class TokenIssuer {
  abstract issue(payload: AccessTokenPayload): Promise<{ token: string; expiresIn: string }>;
}
