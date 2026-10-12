/**
 * Erros de domínio. Não dependem de HTTP: o mapeamento para códigos de estado
 * é feito na camada de apresentação (DomainExceptionFilter).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Recurso inexistente → 404 */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
}

/** Violação de unicidade / estado concorrente → 409 */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
}

/** Regra de negócio violada → 422 */
export class BusinessRuleError extends DomainError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
}

/** Entrada inválida detectada no domínio → 400 */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
}

/** Credenciais / sessão inválida → 401 */
export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED';
}

/** Sem permissão → 403 */
export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
}

/** Configuração em falta (ex.: estado de factura não semeado) → 500 */
export class MisconfigurationError extends DomainError {
  readonly code = 'MISCONFIGURATION';
}
