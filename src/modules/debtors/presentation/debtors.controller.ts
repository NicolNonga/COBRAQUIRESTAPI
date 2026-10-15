import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, Min } from 'class-validator';
import { ApiSort, ListQueryDto, parseSort, toBool } from '@/shared/presentation/criteria-query.dto';
import { DEBTOR_SORTABLE } from '../domain/debtor.repository';

class DebtorListQuery extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) debtorTypeId?: number;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @toBool() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @toBool() @IsBoolean() isCompany?: boolean;
  @ApiPropertyOptional({ format: 'date',  example: '2026-01-01' }) @IsOptional() @IsDateString({ strict: true }) createdFrom?: string;
  @ApiPropertyOptional({ format: 'date',  example: '2026-12-31' }) @IsOptional() @IsDateString({ strict: true }) createdTo?: string;
}
import { assertFileType, IMAGE_TYPES, toBinary } from '@/shared/presentation/upload';
import * as U from '../application/debtor.use-cases';
import * as R from '../application/contact-restriction.use-cases';
import { AddRestrictionDto, LiftRestrictionDto } from './dto/contact-restriction.dto';
import { DebtorDto } from './dto/debtor.dto';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { collectAllPages } from '@/shared/application/export-all';
import { activeFilters, entityName, exportUserName, pdfResponse, rangeLabel, yesNo } from '@/shared/presentation/pdf-export';
import { debtorsPdf } from '@/modules/reports/application/list-pdfs';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';

@ApiTags('Devedores')
@ApiBearerAuth()
@Controller()
export class DebtorsController {
  constructor(
    private readonly createDebtor: U.CreateDebtorUseCase,
    private readonly updateDebtor: U.UpdateDebtorUseCase,
    private readonly setActive: U.SetDebtorActiveUseCase,
    private readonly logo: U.GetDebtorLogoUseCase,
    private readonly queries: U.DebtorQueriesUseCase,
    private readonly listRestrictions: R.ListContactRestrictionsUseCase,
    private readonly addRestriction: R.AddContactRestrictionUseCase,
    private readonly liftRestriction: R.LiftContactRestrictionUseCase,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Post('debtors')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(P.DEBTOR_CREATE)
  async create(@Body() dto: DebtorDto, @UploadedFile() file?: Express.Multer.File) {
    assertFileType(file, IMAGE_TYPES);
    const { id } = await this.createDebtor.execute({ ...dto, logo: file ? toBinary(file) : undefined });
    return { message: 'Devedor Registado', id };
  }

  @Get('debtors')
  @ApiOperation({ summary: 'Listar devedores (search: nome, NIF ou email)', description: `Ordenação: ${DEBTOR_SORTABLE.join(', ')}` })
  @ApiSort(DEBTOR_SORTABLE, 'name:asc')
  @RequirePermissions(P.DEBTOR_VIEW)
  index(@Query() q: DebtorListQuery) {
    return this.queries.list({ ...q, sort: parseSort(q.sort, DEBTOR_SORTABLE) });
  }

  @Get('debtors/export/pdf')
  @ApiOperation({ summary: 'Exportar em PDF os devedores que correspondem aos filtros (todas as linhas que correspondem aos filtros)' })
  @RequirePermissions(P.DEBTOR_VIEW)
  async exportPdf(@CurrentUser() me: AuthenticatedUser, @Query() q: DebtorListQuery) {
    const sort = parseSort(q.sort, DEBTOR_SORTABLE);
    const all = await collectAllPages((page, perPage) => this.queries.list({ ...q, sort, page, perPage }));
    const filters = activeFilters([
      ['Pesquisa', q.search], ['Credor', await entityName(this.ds, 'organizations', q.organizationId)],
      ['Estado', yesNo(q.isActive, 'Activos', 'Inactivos')], ['Tipo', yesNo(q.isCompany, 'Empresas', 'Particulares')],
      ['Registo', rangeLabel(q.createdFrom, q.createdTo)],
    ]);
    return pdfResponse(debtorsPdf(all.rows, { generatedBy: await exportUserName(this.ds, me), filters, total: all.total, truncated: all.truncated }), 'devedores');
  }

  @Get('debtors/dashboard')
  @ApiOperation({ summary: 'Totais de devedores (1 query agregada)' })
  @RequirePermissions(P.DEBTOR_VIEW)
  async dashboard() {
    return { data: await this.queries.dashboard() };
  }

  @Get('debtors/:debtorId/contact-restrictions')
  @ApiOperation({ summary: 'Oposições a contacto do devedor (activas e levantadas)' })
  @RequirePermissions(P.DEBTOR_VIEW)
  async restrictions(@Param('debtorId', IdPipe) id: number) {
    return { data: await this.listRestrictions.execute(id) };
  }

  @Post('debtors/:debtorId/contact-restrictions')
  @ApiOperation({ summary: 'Registar que o devedor não quer ser contactado (EMAIL, SMS ou ALL). Efeito imediato.' })
  @RequirePermissions(P.CONTACT_RESTRICTION_ADD)
  async restrict(@CurrentUser() me: AuthenticatedUser, @Param('debtorId', IdPipe) id: number, @Body() dto: AddRestrictionDto) {
    const r = await this.addRestriction.execute(me.id, id, dto);
    return { message: 'Oposição registada. O devedor deixa de receber mensagens neste canal.', id: r.id };
  }

  @Delete('debtors/:debtorId/contact-restrictions/:restrictionId')
  @ApiOperation({ summary: 'Levantar uma oposição (fica o histórico, com quem levantou e porquê)' })
  @RequirePermissions(P.CONTACT_RESTRICTION_LIFT)
  async lift(@CurrentUser() me: AuthenticatedUser, @Param('debtorId', IdPipe) id: number, @Param('restrictionId', IdPipe) rid: number, @Body() dto: LiftRestrictionDto) {
    await this.liftRestriction.execute(me.id, id, rid, dto.reason);
    return { message: 'Oposição levantada' };
  }

  @Get('debtors/:debtorId/debt')
  @ApiOperation({ summary: 'Dívida de um devedor: em aberto, vencida e já liquidada (1 query agregada)' })
  @RequirePermissions(P.DEBTOR_VIEW)
  async debt(@Param('debtorId', IdPipe) id: number) {
    return { data: await this.queries.debtSummary(id) };
  }

  @Get('debtors/dropdown')
  async dropdown() {
    return { data: await this.queries.dropdown() };
  }

  @Put('debtors/desable/:debtorId')
  @RequirePermissions(P.DEBTOR_TOGGLE)
  async disable(@Param('debtorId', IdPipe) id: number) {
    await this.setActive.execute(id, false);
    return { message: 'Devedor desactivado' };
  }

  @Put('debtors/enable/:debtorId')
  @RequirePermissions(P.DEBTOR_TOGGLE)
  async enable(@Param('debtorId', IdPipe) id: number) {
    await this.setActive.execute(id, true);
    return { message: 'Devedor activado' };
  }

  @Put('debtors/:debtorId')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(P.DEBTOR_UPDATE)
  async update(@Param('debtorId', IdPipe) id: number, @Body() dto: DebtorDto, @UploadedFile() file?: Express.Multer.File) {
    assertFileType(file, IMAGE_TYPES);
    await this.updateDebtor.execute(id, { ...dto, logo: file ? toBinary(file) : undefined });
    return { message: 'Devedor actualizado' };
  }

  @Get('user_wallet/dropdown/user/:userId')
  @ApiOperation({ summary: 'Devedores activos ainda sem carteira' })
  @RequirePermissions(P.WALLET_MANAGE)
  async withoutWallet() {
    return { data: await this.queries.withoutWallet() };
  }

  @Get('file/logo_debtor/dowload/:debtorId')
  @RequirePermissions(P.DEBTOR_VIEW)
  async downloadLogo(@Param('debtorId', IdPipe) id: number, @Res() res: Response) {
    res.download(await this.logo.execute(id));
  }
}
