import { Body, Controller, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiSort, ListQueryDto, parseSort, toBool } from '@/shared/presentation/criteria-query.dto';
import { ORGANIZATION_SORTABLE } from '../domain/organization.repository';

class OrganizationListQuery extends ListQueryDto {
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @toBool() @IsBoolean() isActive?: boolean;
}
import { assertFileType, IMAGE_TYPES, toBinary } from '@/shared/presentation/upload';
import {
  CreateOrganizationUseCase,
  ListOrganizationsUseCase,
  SetOrganizationActiveUseCase,
  UpdateOrganizationUseCase,
} from '../application/organization.use-cases';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';

@ApiTags('Organizações')
@ApiBearerAuth()
@Controller('organization')
export class OrganizationsController {
  constructor(
    private readonly createOrg: CreateOrganizationUseCase,
    private readonly setActive: SetOrganizationActiveUseCase,
    private readonly list: ListOrganizationsUseCase,
    private readonly updateOrg: UpdateOrganizationUseCase,
  ) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Criar organização (logo opcional: png/jpg)' })
  @RequirePermissions(P.ORGANIZATION_MANAGE)
  async create(@Body() dto: CreateOrganizationDto, @UploadedFile() file?: Express.Multer.File) {
    assertFileType(file, IMAGE_TYPES);
    const data = await this.createOrg.execute({ ...dto, logo: file ? toBinary(file) : undefined });
    return { message: 'Organização registada', data };
  }

  @Get()
  @ApiOperation({ summary: 'Listar organizações (search: nome, email, telefone)', description: `Ordenação: ${ORGANIZATION_SORTABLE.join(', ')}` })
  @ApiSort(ORGANIZATION_SORTABLE, 'name:asc')
  @RequirePermissions(P.ORGANIZATION_VIEW)
  index(@Query() q: OrganizationListQuery) {
    return this.list.list({ ...q, sort: parseSort(q.sort, ORGANIZATION_SORTABLE) });
  }

  @Get('dropdown')
  async dropdown() {
    return { data: await this.list.dropdown() };
  }

  @Put('desable/:organizationId')
  @RequirePermissions(P.ORGANIZATION_MANAGE)
  async disable(@Param('organizationId', IdPipe) id: number) {
    await this.setActive.execute(id, false);
    return { message: 'Organização desactivada' };
  }

  @Put('enable/:organizationId')
  @RequirePermissions(P.ORGANIZATION_MANAGE)
  async enable(@Param('organizationId', IdPipe) id: number) {
    await this.setActive.execute(id, true);
    return { message: 'Organização activada' };
  }

  @Put(':organizationId')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Editar credor (novo logo opcional: png/jpg)' })
  @RequirePermissions(P.ORGANIZATION_MANAGE)
  async update(@Param('organizationId', IdPipe) id: number, @Body() dto: CreateOrganizationDto, @UploadedFile() file?: Express.Multer.File) {
    assertFileType(file, IMAGE_TYPES);
    await this.updateOrg.execute(id, { ...dto, logo: file ? toBinary(file) : undefined });
    return { message: 'Credor actualizado' };
  }
}
