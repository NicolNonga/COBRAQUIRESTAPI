import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catalogEntry } from '@/modules/access-control/domain/permission-catalog';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { ForbiddenError } from '@/shared/domain/errors';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PERMISSIONS_KEY } from './require-permissions.decorator';

/**
 * Autorização global (APP_GUARD, corre depois do JwtAuthGuard).
 * Rotas marcadas com @RequirePermissions(...) só passam se o perfil do utilizador
 * tiver TODAS as permissões indicadas. As permissões do utilizador são lidas da BD
 * em cada pedido (JwtStrategy), por isso retirar uma permissão a um perfil tem efeito imediato.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    if (!required?.length) return true;
    const user: AuthenticatedUser | undefined = ctx.switchToHttp().getRequest().user;
    const granted = new Set(user?.permissions ?? []);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length) {
      const what = missing.map((s) => catalogEntry(s)?.name ?? s).join(', ');
      throw new ForbiddenError(`Não tem permissão para esta operação (${what}). Peça acesso ao administrador.`);
    }
    return true;
  }
}
