import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as P from './application/permission.use-cases';
import * as R from './application/role.use-cases';
import { PermissionRepository, RolePermissionRepository, RoleRepository } from './domain/access-control.repository';
import { PermissionOrmEntity, RoleOrmEntity } from './infrastructure/access-control.orm-entities';
import { TypeOrmPermissionRepository, TypeOrmRoleRepository } from './infrastructure/typeorm-access-control.repository';
import { PermissionCatalogBootstrap } from './infrastructure/permission-catalog.bootstrap';
import { PermissionsController, RolePermissionsController, RolesController } from './presentation/access-control.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RoleOrmEntity, PermissionOrmEntity])],
  controllers: [RolesController, PermissionsController, RolePermissionsController],
  providers: [
    { provide: RoleRepository, useClass: TypeOrmRoleRepository },
    TypeOrmPermissionRepository,
    { provide: PermissionRepository, useExisting: TypeOrmPermissionRepository },
    { provide: RolePermissionRepository, useExisting: TypeOrmPermissionRepository },
    R.CreateRoleUseCase,
    R.UpdateRoleUseCase,
    R.SetRoleActiveUseCase,
    R.ListRolesUseCase,
    PermissionCatalogBootstrap,
    P.ListPermissionsUseCase,
    P.AttachPermissionToRoleUseCase,
    P.DetachPermissionFromRoleUseCase,
  ],
  exports: [RoleRepository, PermissionRepository],
})
export class AccessControlModule {}
