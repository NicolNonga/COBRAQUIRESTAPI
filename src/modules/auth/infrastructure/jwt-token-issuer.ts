import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload, TokenIssuer } from '../application/token-issuer.port';

@Injectable()
export class JwtTokenIssuer extends TokenIssuer {
  constructor(private readonly jwt: JwtService, private readonly cfg: ConfigService) {
    super();
  }
  async issue(payload: AccessTokenPayload) {
    return { token: await this.jwt.signAsync(payload), expiresIn: this.cfg.get<string>('JWT_EXPIRES_IN', '1h') };
  }
}
