import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { PaginationQueryDto } from '@/shared/presentation/pagination.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { ApiSort, ListQueryDto, parseSort, toBool } from '@/shared/presentation/criteria-query.dto';
import { USER_SORTABLE } from '../domain/user.repository';

class UserListQuery extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) roleId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) categoryId?: number;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @toBool() @IsBoolean() isActive?: boolean;
}
import { CreateUserUseCase } from '../application/create-user.use-case';
import * as U from '../application/user-management.use-cases';
import { GetUserPermissionsUseCase, SetUserPermissionsUseCase } from '../application/user-permissions.use-cases';
import { ChangePasswordDto, CreateUserDto, SetUserPermissionsDto, UpdateUserDto } from './dto/user.dto';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';

@ApiTags('Utilizadores')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly createUser: CreateUserUseCase,
    private readonly updateUser: U.UpdateUserUseCase,
    private readonly setActive: U.SetUserActiveUseCase,
    private readonly adminReset: U.AdminResetPasswordUseCase,
    private readonly changeOwn: U.ChangeOwnPasswordUseCase,
    private readonly queries: U.UserQueriesUseCase,
    private readonly getPermissions: GetUserPermissionsUseCase,
    private readonly setPermissions: SetUserPermissionsUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Criar utilizador (palavra-passe gerada e enviada por email após commit)' })
  @RequirePermissions(P.USER_CREATE)
  async create(@Body() dto: CreateUserDto) {
    const { id } = await this.createUser.execute(dto);
    return { message: 'Utilizador Criado', id };
  }

  @Get()
  @ApiOperation({ summary: 'Listar utilizadores (search: nome ou email)', description: `Ordenação: ${USER_SORTABLE.join(', ')}` })
  @ApiSort(USER_SORTABLE, 'fullName:asc')
  @RequirePermissions(P.USER_VIEW)
  index(@Query() q: UserListQuery) {
    return this.queries.list({ ...q, sort: parseSort(q.sort, USER_SORTABLE) });
  }

  @Get('dropDownList')
  async dropdown() {
    return { data: await this.queries.dropdown() };
  }

  @Get('dropDownListMangers')
  async managers() {
    return { data: await this.queries.managers() };
  }

  @Get('organization/:organizationId')
  @RequirePermissions(P.USER_VIEW)
  async byOrganization(@CurrentUser() me: AuthenticatedUser, @Param('organizationId', IdPipe) orgId: number) {
    return { data: await this.queries.inOrganization(me.id, orgId) };
  }

  @Put('new_password')
  @ApiOperation({ summary: 'Alterar a própria palavra-passe (exige a actual)' })
  async changePassword(@CurrentUser() me: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    await this.changeOwn.execute(me.id, dto.currentPassword, dto.newPassword);
    return { message: 'Palavra-passe actualizada. Inicie sessão novamente.' };
  }

  @Get(':userId/permissions')
  @ApiOperation({ summary: 'Permissões do utilizador: as do perfil e as dadas só a ele' })
  @RequirePermissions(P.USER_VIEW)
  async permissions(@Param('userId', IdPipe) id: number) {
    return { data: await this.getPermissions.execute(id) };
  }

  @Put(':userId/permissions')
  @ApiOperation({ summary: 'Definir as permissões individuais do utilizador (somam-se às do perfil; só se dá o que se tem)' })
  @RequirePermissions(P.USER_PERMISSIONS_MANAGE)
  async updatePermissions(@CurrentUser() me: AuthenticatedUser, @Param('userId', IdPipe) id: number, @Body() dto: SetUserPermissionsDto) {
    const r = await this.setPermissions.execute(me, id, dto.permissions);
    return { message: 'Permissões do utilizador actualizadas', data: r };
  }

  @Put(':userId/desable')
  @RequirePermissions(P.USER_TOGGLE)
  async disable(@CurrentUser() me: AuthenticatedUser, @Param('userId', IdPipe) id: number) {
    if (me.id === id) throw new ForbiddenException('Não pode desactivar o seu próprio utilizador');
    await this.setActive.execute(id, false);
    return { message: 'Utilizador desactivado' };
  }

  @Put(':userId/enable')
  @RequirePermissions(P.USER_TOGGLE)
  async enable(@Param('userId', IdPipe) id: number) {
    await this.setActive.execute(id, true);
    return { message: 'Utilizador activado' };
  }

  @Put(':userId/redefinar_senha')
  @RequirePermissions(P.USER_RESET_PASSWORD)
  async resetPassword(@Param('userId', IdPipe) id: number) {
    await this.adminReset.execute(id);
    return { message: 'Palavra-passe redefinida' };
  }

  @Put(':userId')
  @RequirePermissions(P.USER_UPDATE)
  async update(@Param('userId', IdPipe) id: number, @Body() dto: UpdateUserDto) {
    await this.updateUser.execute(id, dto);
    return { message: 'Utilizador actualizado' };
  }
}

/** Endpoints de equipa mantidos no prefixo original /user_wallet. */
@ApiTags('Carteiras')
@ApiBearerAuth()
@Controller('user_wallet')
export class TeamController {
  constructor(private readonly queries: U.UserQueriesUseCase) {}

  @Get('manager')
  @ApiOperation({ summary: 'Agentes do gestor autenticado (paginado)' })
  agents(@CurrentUser() me: AuthenticatedUser, @Query() q: PaginationQueryDto) {
    return this.queries.agentsOf(me.id, q);
  }

  @Get('list_agents_by_Manger')
  @ApiOperation({ summary: 'Todos os agentes activos do gestor autenticado' })
  async allAgents(@CurrentUser() me: AuthenticatedUser) {
    return this.queries.allAgentsOf(me.id);
  }
}
