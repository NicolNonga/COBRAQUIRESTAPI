export abstract class PasswordResetTokenRepository {
  abstract create(email: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /**
   * Consome o token de forma ATÓMICA (UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING).
   * Dois pedidos concorrentes com o mesmo token: só um consegue. Devolve o email ou null.
   */
  abstract consume(tokenHash: string): Promise<string | null>;
  abstract invalidateAllFor(email: string): Promise<void>;
}
