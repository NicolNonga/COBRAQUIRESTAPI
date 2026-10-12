import { QueryFailedError } from 'typeorm';

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

export interface PgDriverError {
  code?: string;
  constraint?: string;
  detail?: string;
}

export const pgError = (err: unknown): PgDriverError | undefined =>
  err instanceof QueryFailedError ? (err.driverError as PgDriverError) : undefined;

export const isUniqueViolation = (err: unknown, constraint?: string): boolean => {
  const e = pgError(err);
  return e?.code === PG_UNIQUE_VIOLATION && (!constraint || e.constraint === constraint);
};
