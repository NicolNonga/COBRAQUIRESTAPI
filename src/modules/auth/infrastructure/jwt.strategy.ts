import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PermissionRepository } from '@/modules/access-control/domain/access-control.repository';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { RequestContext } from '@/shared/application/request-context';
import { UnauthorizedError } from '@/shared/domain/errors';
import { AccessTokenPayload } from '../application/token-issuer.port';
import { tokenFromCookie } from '../presentation/session-cookie';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService, private readonly users: UserRepository, private readonly perms: PermissionRepository) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), (req) => tokenFromCookie(req)]),
      ignoreExpiration: false,
      secretOrKey: cfg.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  /**
   * Validação por pedido: utilizador activo, perfil activo e token_version igual.
   * Assim desactivar um utilizador ou trocar palavra-passe corta o acesso imediatamente.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const snap = await this.users.findAuthSnapshot(payload.sub);
    if (!snap || !snap.isActive || snap.tokenVersion !== payload.tv) throw new UnauthorizedError('Sessão inválida ou expirada');
    const permissions = snap.roleId && snap.roleActive ? await this.perms.activeSlugsForRole(snap.roleId) : [];
    RequestContext.setUser(snap.id);
    return {
      id: snap.id,
      email: snap.email,
      roleId: snap.roleId,
      organizationId: snap.organizationId,
      isManager: snap.isManager,
      permissions,
    };
  }
}
