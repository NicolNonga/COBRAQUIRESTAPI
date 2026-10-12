import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { ValidationError } from '@/shared/domain/errors';
import { InvoiceDocumentUseCases } from '../application/invoice-document.use-cases';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { InvoiceStateCode } from '@/modules/catalogs/domain/state-catalog.port';
import { ApiSort, ListQueryDto, parseSort, toBool } from '@/shared/presentation/criteria-query.dto';
import { INVOICE_SORTABLE } from '../domain/invoice.repository';

import { Idempotent } from '@/infrastructure/idempotency/idempotent.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { assertFileType, PDF_TYPES, toBinary } from '@/shared/presentation/upload';
import { CreateInvoiceUseCase } from '../application/create-invoice.use-case';
import { InvoiceQueriesUseCase } from '../application/invoice-queries.use-case';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceUseCase } from '../application/update-invoice.use-case';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';

import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { collectAllPages } from '@/shared/application/export-all';
import { activeFilters, entityName, exportUserName, pdfResponse, rangeLabel, yesNo } from '@/shared/presentation/pdf-export';
import { invoicesPdf } from '@/modules/reports/application/list-pdfs';

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

class InvoiceListQuery extends ListQueryDto {
  @ApiPropertyOptional({ description: 'Estado(s), separados por vírgula', example: 'OVERDUE,IN_DISPUTE', enum: InvoiceStateCode, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim().toUpperCase()))
  @IsIn(Object.values(InvoiceStateCode), { each: true })
  state?: InvoiceStateCode[];

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) debtorId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) currencyId?: number;
  @ApiPropertyOptional({ example: '1000.00' }) @IsOptional() @Matches(MONEY) minAmount?: string;
  @ApiPropertyOptional({ example: '50000.00' }) @IsOptional() @Matches(MONEY) maxAmount?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-01-01' }) @IsOptional() @IsDateString({ strict: true }) dueDateFrom?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-12-31' }) @IsOptional() @IsDateString({ strict: true }) dueDateTo?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-01-01' }) @IsOptional() @IsDateString({ strict: true }) issueDateFrom?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-01-01' }) @IsOptional() @IsDateString({ strict: true }) issueDateTo?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @toBool() @IsBoolean() inProcess?: boolean;
}

const STATE_LABEL: Record<string, string> = { PENDING: 'Pendente', IN_PROGRESS: 'Em cobrança', OVERDUE: 'Vencida', IN_DISPUTE: 'Em disputa', PARTIALLY_PAID: 'Paga parcialmente', PAID: 'Paga', CANCELLED: 'Anulada' };
const SORT_DOC = `Ordenação permitida: ${INVOICE_SORTABLE.join(', ')}`;

@ApiTags('Facturas')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly createInvoice: CreateInvoiceUseCase,
    private readonly queries: InvoiceQueriesUseCase,
    private readonly documents: InvoiceDocumentUseCases,
    private readonly updateInvoice: UpdateInvoiceUseCase,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Post()
  @Idempotent({ required: false })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Registar factura (PDF opcional). Data de vencimento = emissão + prazo.' })
  @RequirePermissions(P.INVOICE_CREATE)
  async create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateInvoiceDto, @UploadedFile() file?: Express.Multer.File) {
    assertFileType(file, PDF_TYPES);
    const { id } = await this.createInvoice.execute({ ...dto, userId: me.id, document: file ? toBinary(file) : undefined });
    return { message: 'Factura registada com sucesso', id };
  }

  @Get()
  @ApiOperation({ summary: 'Listar facturas com filtros dinâmicos', description: SORT_DOC })
  @ApiSort(INVOICE_SORTABLE, 'dueDate:asc')
  @RequirePermissions(P.INVOICE_VIEW)
  index(@Query() q: InvoiceListQuery) {
    return this.queries.list({ ...q, states: q.state, sort: parseSort(q.sort, INVOICE_SORTABLE) });
  }

  @Get('export/pdf')
  @ApiOperation({ summary: 'Exportar em PDF as facturas que correspondem aos filtros (todas as linhas que correspondem aos filtros)' })
  @RequirePermissions(P.INVOICE_VIEW)
  async exportPdf(@CurrentUser() me: AuthenticatedUser, @Query() q: InvoiceListQuery) {
    const sort = parseSort(q.sort, INVOICE_SORTABLE);
    const all = await collectAllPages((page, perPage) => this.queries.list({ ...q, states: q.state, sort, page, perPage }));
    const filters = activeFilters([
      ['Pesquisa', q.search], ['Estado', q.state?.length ? q.state.map((x) => STATE_LABEL[x] ?? x).join(', ') : null],
      ['Devedor', await entityName(this.ds, 'debtors', q.debtorId)],
      ['Vencimento', rangeLabel(q.dueDateFrom, q.dueDateTo)], ['Emissão', rangeLabel(q.issueDateFrom, q.issueDateTo)],
      ['Valor mínimo', q.minAmount], ['Valor máximo', q.maxAmount], ['Em processo', yesNo(q.inProcess, 'Sim', 'Não')],
    ]);
    return pdfResponse(invoicesPdf(all.rows, { generatedBy: await exportUserName(this.ds, me), filters, total: all.total, truncated: all.truncated }), 'facturas');
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Facturas vencidas (mesmos filtros)', description: SORT_DOC })
  @ApiSort(INVOICE_SORTABLE, 'dueDate:asc')
  @RequirePermissions(P.INVOICE_VIEW)
  overdue(@Query() q: InvoiceListQuery) {
    return this.queries.overdue({ ...q, sort: parseSort(q.sort, INVOICE_SORTABLE) });
  }

  @Get(':id/document')
  @ApiOperation({ summary: 'Ver/descarregar o PDF da factura (?download=1 força o download)' })
  @RequirePermissions(P.INVOICE_VIEW)
  async document(@Param('id', IdPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const f = await this.documents.file(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${f.fileName}"`);
    res.sendFile(f.path);
  }

  @Post(':id/document')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Anexar o PDF a uma factura registada sem documento' })
  @RequirePermissions(P.INVOICE_CREATE)
  async attachDocument(@Param('id', IdPipe) id: number, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ValidationError('Escolha o PDF da factura');
    assertFileType(file, PDF_TYPES);
    await this.documents.attach(id, toBinary(file));
    return { message: 'PDF anexado à factura' };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Editar factura (bloqueada se paga/cancelada/em disputa; em processo só o número muda)' })
  @RequirePermissions(P.INVOICE_UPDATE)
  async update(@Param('id', IdPipe) id: number, @Body() dto: UpdateInvoiceDto) {
    await this.updateInvoice.execute(id, dto);
    return { message: 'Factura actualizada' };
  }
}
