import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import * as U from '../application/auth.use-cases';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';
import { Public } from './public.decorator';
import { clearSessionCookie, setSessionCookie } from './session-cookie';

@ApiTags('Autenticação')
@Controller()
export class AuthController {
  constructor(
    private readonly login: U.LoginUseCase,
    private readonly logout: U.LogoutUseCase,
    private readonly forgot: U.RequestPasswordResetUseCase,
    private readonly reset: U.ResetPasswordUseCase,
    private readonly me: U.GetMeUseCase,
    private readonly cfg: ConfigService,
  ) {}

  @Public()
 // @Throttle({ default: { limit: 5, ttl: 60_000 } }) // anti brute-force vamos tirar so por questoe de teste
  @Post('auth')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login (devolve JWT + utilizador com permissões)' })
  async signIn(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const data = await this.login.execute(dto.email, dto.password);
    setSessionCookie(res, data.token.token, data.token.expiresIn, this.cfg); // cookie HttpOnly: o browser guarda a sessão sem expor o token ao JavaScript
    return { message: 'Login feito com sucesso', data };
  }

  @ApiBearerAuth()
  @Post('auth/logout')
  @HttpCode(200)
  async signOut(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.logout.execute(user.id);
    clearSessionCookie(res, this.cfg);
    return { message: 'Sessão terminada' };
  }

  @ApiBearerAuth()
  @Get('auth/me')
  async current(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.me.execute(user.id) };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forget_password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.forgot.execute(dto.email);
    return { message: 'Se o email existir, foram enviadas instruções' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset_password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.reset.execute(dto.token, dto.newPassword);
    return { message: 'Nova palavra-passe definida' };
  }
}
