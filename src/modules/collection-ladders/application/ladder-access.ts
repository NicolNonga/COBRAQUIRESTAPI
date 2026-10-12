import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { ForbiddenError, NotFoundError } from '@/shared/domain/errors';
import { Ladder } from '../domain/ladder.repository';

/** Só o dono (o comercial que a criou) pode alterar a sua régua. */
export const assertOwner = (ladder: Ladder | null, me: AuthenticatedUser): Ladder => {
  if (!ladder || ladder.archivedAt) throw new NotFoundError('Régua não encontrada');
  if (ladder.ownerUserId !== me.id) throw new ForbiddenError('Só o dono pode alterar esta régua');
  return ladder;
};
