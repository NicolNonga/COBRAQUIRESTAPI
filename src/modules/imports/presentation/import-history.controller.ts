import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { IMPORT_KINDS, IMPORT_STATUSES, ImportHistoryService, type ImportKind, type ImportStatus } from '../application/import-history.service';

class ImportHistoryQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage: number = 20;
  @ApiPropertyOptional({ enum: IMPORT_KINDS }) @IsOptional() @IsIn(IMPORT_KINDS) kind?: ImportKind;
  @ApiPropertyOptional({ enum: IMPORT_STATUSES }) @IsOptional() @IsIn(IMPORT_STATUSES) status?: ImportStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) userId?: number;
  @ApiPropertyOptional({ description: 'Nome do ficheiro ou utilizador' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Importações')
@ApiBearerAuth()
@RequirePermissions(P.IMPORT_HISTORY_VIEW)
@Controller('import-history')
export class ImportHistoryController {
  constructor(private readonly history: ImportHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'Histórico de importações (mais recentes primeiro)' })
  list(@Query() q: ImportHistoryQuery) {
    return this.history.list(q);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Resumo dos últimos 30 dias' })
  async stats() {
    return { data: await this.history.stats() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma importação, com os erros de cada linha' })
  async get(@Param('id', ParseIntPipe) id: number) {
    return { data: await this.history.get(id) };
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Conteúdo do ficheiro original (primeiras 1000 linhas) com os erros por linha' })
  async preview(@Param('id', ParseIntPipe) id: number) {
    return { data: await this.history.preview(id) };
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Descarregar o ficheiro original importado' })
  async file(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.history.originalFile(id);
    res.type(XLSX).download(f.path, f.fileName);
  }

  @Get(':id/error-report')
  @ApiOperation({ summary: 'Descarregar o ficheiro com as linhas com erro assinaladas' })
  async errorReport(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.history.errorReport(id);
    res.type(XLSX).download(f.path, f.fileName);
  }
}
