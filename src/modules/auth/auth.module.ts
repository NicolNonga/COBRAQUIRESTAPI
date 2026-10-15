import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { UsersModule } from '../users/users.module';
import * as U from './application/auth.use-cases';
import { TokenIssuer } from './application/token-issuer.port';
import { LoginAttemptRepository } from './domain/login-attempt.repository';
import { PasswordResetTokenRepository } from './domain/password-reset-token.repository';
import { TypeOrmLoginAttemptRepository } from './infrastructure/typeorm-login-attempt.repository';
import { JwtTokenIssuer } from './infrastructure/jwt-token-issuer';
import { JwtStrategy } from './infrastructure/jwt.strategy';
import { PasswordResetTokenOrmEntity } from './infrastructure/password-reset-token.orm-entity';
import { TypeOrmPasswordResetTokenRepository } from './infrastructure/typeorm-password-reset-token.repository';
import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/jwt-auth.guard';
import { PermissionsGuard } from './presentation/permissions.guard';
import { VisibilityGuard } from './presentation/visibility.guard';

export const jwtModule = JwtModule.registerAsync({
  global: true, // usado também pelo gateway WebSocket
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    secret: cfg.getOrThrow<string>('JWT_SECRET'),
    signOptions: { expiresIn: cfg.get<string>('JWT_EXPIRES_IN', '1h'), algorithm: 'HS256', issuer: cfg.get<string>('JWT_ISSUER', 'cobraqui-api'), audience: cfg.get<string>('JWT_AUDIENCE', 'cobraqui-app') },
    // vale para todas as verificações (também o gateway WebSocket)
    verifyOptions: { algorithms: ['HS256'], issuer: cfg.get<string>('JWT_ISSUER', 'cobraqui-api'), audience: cfg.get<string>('JWT_AUDIENCE', 'cobraqui-app') },
  }),
});

@Module({
  imports: [PassportModule, jwtModule, TypeOrmModule.forFeature([PasswordResetTokenOrmEntity]), UsersModule, AccessControlModule],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    { provide: TokenIssuer, useClass: JwtTokenIssuer },
    { provide: PasswordResetTokenRepository, useClass: TypeOrmPasswordResetTokenRepository },
    { provide: LoginAttemptRepository, useClass: TypeOrmLoginAttemptRepository },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // autenticação por omissão em TODAS as rotas
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: VisibilityGuard }, // objecto a objecto: o agente só vê o que é seu
    U.LoginUseCase,
    U.LogoutUseCase,
    U.RequestPasswordResetUseCase,
    U.ResetPasswordUseCase,
    U.GetMeUseCase,
  ],
})
export class AuthModule {}
