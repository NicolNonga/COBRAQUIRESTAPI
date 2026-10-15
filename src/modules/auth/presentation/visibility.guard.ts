import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { resolveTeamScope } from '@/shared/application/team-scope';
import { VisibilityChecker } from '@/shared/application/visibility.port';
import { NotFoundError } from '@/shared/domain/errors';
import { VISIBLE_TO_KEY, VisibleToMeta } from './visible-to.decorator';

const asId = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
};

/** Autorização ao nível do objecto (BOLA): corre depois da autenticação e das permissões. */
@Injectable()
export class VisibilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly checker: VisibilityChecker) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<VisibleToMeta | undefined>(VISIBLE_TO_KEY, ctx.getHandler());
    if (!meta) return true;
    const req = ctx.switchToHttp().getRequest();
    const me: AuthenticatedUser | undefined = req.user;
    if (!me) return true; // rotas públicas não têm este decorador; sem utilizador o JwtAuthGuard já recusou
    const scope = resolveTeamScope(me, P.AGENTS_VIEW_ALL);
    if (scope.kind === 'ALL') return true;
    const ids = meta.ids(req).map(asId).filter((x): x is number => x !== null);
    if (!ids.length) return true; // nada a verificar: a validação do DTO trata do resto
    if (!(await this.checker.allVisible(meta.resource, scope, ids))) throw new NotFoundError('Registo não encontrado');
    return true;
  }
}
