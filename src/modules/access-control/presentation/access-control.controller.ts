import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { PaginationQueryDto } from '@/shared/presentation/pagination.dto';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { AttachPermissionToRoleUseCase, DetachPermissionFromRoleUseCase, ListPermissionsUseCase } from '../application/permission.use-cases';
import { P } from '../domain/permission-catalog';
import { CreateRoleUseCase, ListRolesUseCase, SetRoleActiveUseCase, UpdateRoleUseCase } from '../application/role.use-cases';
import { CreateRoleDto, RolePermissionDto, UpdateRoleDto } from './dto/access-control.dto';

@ApiTags('Perfis')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(
    private readonly createRole: CreateRoleUseCase,
    private readonly updateRole: UpdateRoleUseCase,
    private readonly setActive: SetRoleActiveUseCase,
    private readonly listRoles: ListRolesUseCase,
  ) {}

  @Post()
  @RequirePermissions(P.ROLE_MANAGE)
  async create(@Body() dto: CreateRoleDto) {
    const role = await this.createRole.execute(dto);
    return { message: 'Perfil Criado Com Sucesso', data: role };
  }

  @Get()
  @RequirePermissions(P.ROLE_VIEW)
  @ApiOperation({ summary: 'Perfis com permissões activas (paginado, sem N+1)' })
  index(@Query() q: PaginationQueryDto) {
    return this.listRoles.paginate(q);
  }

  @Get('list-dropdown')
  async dropdown() {
    return { data: await this.listRoles.dropdown() };
  }

  @Get('managers')
  async managers() {
    return { data: await this.listRoles.managers() };
  }

  @Put(':roleId/desable')
  @RequirePermissions(P.ROLE_MANAGE)
  async disable(@Param('roleId', IdPipe) id: number) {
    await this.setActive.execute(id, false);
    return { message: 'Perfil desativado' };
  }

  @Put(':roleId/enable')
  @RequirePermissions(P.ROLE_MANAGE)
  async enable(@Param('roleId', IdPipe) id: number) {
    await this.setActive.execute(id, true);
    return { message: 'Perfil activado' };
  }

  @Put(':roleId')
  @RequirePermissions(P.ROLE_MANAGE)
  async update(@Param('roleId', IdPipe) id: number, @Body() dto: UpdateRoleDto) {
    await this.updateRole.execute(id, dto);
    return { message: 'Perfil actualizado' };
  }
}

@ApiTags('Permissões')
@ApiBearerAuth()
@Controller('permission')
@RequirePermissions(P.ROLE_VIEW)
export class PermissionsController {
  constructor(private readonly list: ListPermissionsUseCase) {}

  @Get()
  @ApiOperation({ summary: 'Permissões (só leitura — vêm do catálogo do código)' })
  index(@Query() q: PaginationQueryDto) {
    return this.list.paginate(q);
  }

  @Get('grouped')
  @ApiOperation({ summary: 'Permissões activas agrupadas por área funcional' })
  async grouped() {
    return { data: await this.list.grouped() };
  }

  @Get('drop-down-list')
  dropdown() {
    return this.list.dropdown();
  }
}

@ApiTags('Perfis')
@ApiBearerAuth()
@Controller('roles_permission')
@RequirePermissions(P.ROLE_MANAGE)
export class RolePermissionsController {
  constructor(
    private readonly attach: AttachPermissionToRoleUseCase,
    private readonly detach: DetachPermissionFromRoleUseCase,
  ) {}

  @Post()
  async store(@Body() dto: RolePermissionDto) {
    await this.attach.execute(dto.role_id, dto.permission_id);
    return { message: 'Permissão associada com sucesso' };
  }

  @Put()
  @ApiOperation({ summary: 'Remove a permissão do perfil (mantido PUT por compatibilidade)' })
  async remove(@Body() dto: RolePermissionDto) {
    await this.detach.execute(dto.role_id, dto.permission_id);
    return { message: 'Permissão removida' };
  }
}
