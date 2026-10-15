import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { CreateUserUseCase } from './application/create-user.use-case';
import * as U from './application/user-management.use-cases';
import { GetUserPermissionsUseCase, SetUserPermissionsUseCase } from './application/user-permissions.use-cases';
import { TeamRepository, UserQueries, UserRepository } from './domain/user.repository';
import { TypeOrmUserRepository } from './infrastructure/typeorm-user.repository';
import { UserOrmEntity, WalletAgentOrmEntity } from './infrastructure/user.orm-entities';
import { TeamController, UsersController } from './presentation/users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserOrmEntity, WalletAgentOrmEntity]), AccessControlModule],
  controllers: [UsersController, TeamController],
  providers: [
    TypeOrmUserRepository,
    { provide: UserRepository, useExisting: TypeOrmUserRepository },
    { provide: UserQueries, useExisting: TypeOrmUserRepository },
    { provide: TeamRepository, useExisting: TypeOrmUserRepository },
    CreateUserUseCase,
    U.UpdateUserUseCase,
    U.SetUserActiveUseCase,
    U.AdminResetPasswordUseCase,
    U.ChangeOwnPasswordUseCase,
    U.UserQueriesUseCase,
    GetUserPermissionsUseCase,
    SetUserPermissionsUseCase,
  ],
  exports: [UserRepository],
})
export class UsersModule {}
