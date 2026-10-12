import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@/infrastructure/idempotency/idempotent.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { PaginationQueryDto } from '@/shared/presentation/pagination.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ProcessStateCode } from '@/modules/catalogs/domain/state-catalog.port';
import { ApiSort, ListQueryDto, parseSort, toBool } from '@/shared/presentation/criteria-query.dto';
import { CONTACT_SORTABLE, PROCESS_SORTABLE } from '../domain/process.repository';
import { CONTACT_STATUSES, ContactStatus } from '../infrastructure/process.orm-entities';
import { ContactHistoryUseCase } from '../application/contact-history.use-case';

class ProcessListQuery extends ListQueryDto {
  @ApiPropertyOptional({ example: 'REGISTERED,IN_PROGRESS', enum: ProcessStateCode, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim().toUpperCase()))
  @IsIn(Object.values(ProcessStateCode), { each: true })
  state?: ProcessStateCode[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) debtorId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) assignedUserId?: number;
  @ApiPropertyOptional({ type: Boolean,  description: 'true = só processos sem responsável' }) @IsOptional() @toBool() @IsBoolean() unassigned?: boolean;
  @ApiPropertyOptional({ type: Boolean,  description: 'true = abertos; false = fechados' }) @IsOptional() @toBool() @IsBoolean() open?: boolean;
  @ApiPropertyOptional({ format: 'date', example: '2026-01-01' }) @IsOptional() @IsDateString({ strict: true }) createdFrom?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-01-01' }) @IsOptional() @IsDateString({ strict: true }) createdTo?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-09-28', description: 'Processos sem contacto desde esta data (inclui os nunca contactados)' })
  @IsOptional() @IsDateString({ strict: true }) noContactSince?: string;
  @ApiPropertyOptional({ enum: CONTACT_STATUSES, isArray: true, description: 'Resultado do último contacto' })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim()))
  @IsIn(CONTACT_STATUSES, { each: true })
  lastContactStatus?: string[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) minContacts?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxContacts?: number;
}

class ContactHistoryQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) userId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) contactTypeId?: number;
  @ApiPropertyOptional({ enum: CONTACT_STATUSES, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim()))
  @IsIn(CONTACT_STATUSES, { each: true })
  status?: ContactStatus[];
  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31T23:59:59Z' }) @IsOptional() @IsDateString() to?: string;
}
import { AssignProcessToUserUseCase, AutoAssignProcessesUseCase } from '../application/assignment.use-cases';
import { CreateContactUseCase } from '../application/create-contact.use-case';
import { GenerateCollectionProcessesUseCase } from '../application/generate-collection-processes.use-case';
import { ProcessQueriesUseCase } from '../application/process-queries.use-case';
import { RemoveInvoicesFromProcessUseCase } from '../application/remove-invoices-from-process.use-case';
import { TransferProcessesUseCase } from '../application/transfer-processes.use-case';
import { AssignProcessDto, CreateContactDto, RemoveInvoicesDto, TransferProcessesDto } from './dto/process.dto';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { collectAllPages } from '@/shared/application/export-all';
import { activeFilters, entityName, exportUserName, pdfResponse, rangeLabel, yesNo } from '@/shared/presentation/pdf-export';
import { processesPdf } from '@/modules/reports/application/list-pdfs';

const STATE_LABEL: Record<string, string> = { REGISTERED: 'Registado', PENDING: 'Pendente', ASSIGNED: 'Atribuído', IN_PROGRESS: 'Em cobrança', FINISHED: 'Concluído', CANCELLED: 'Cancelado' };
const CONTACT_LABEL: Record<string, string> = { attempted: 'Tentativa', answered: 'Atendido', negotiation_started: 'Negociação iniciada', no_answer: 'Sem resposta', failed: 'Falhou', pending: 'Pendente' };

@ApiTags('Processos')
@ApiBearerAuth()
@Controller('process')
export class ProcessesController {
  constructor(
    private readonly generate: GenerateCollectionProcessesUseCase,
    private readonly assign: AssignProcessToUserUseCase,
    private readonly autoAssign: AutoAssignProcessesUseCase,
    private readonly removeInvoices: RemoveInvoicesFromProcessUseCase,
    private readonly transfer: TransferProcessesUseCase,
    private readonly queries: ProcessQueriesUseCase,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Post('generate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gerar processos a partir de facturas vencidas (idempotente)' })
  @RequirePermissions(P.PROCESS_ASSIGN)
  async generateNow() {
    return { message: 'Processos gerados com sucesso', data: await this.generate.execute() };
  }

  @Get()
  @ApiOperation({ summary: 'Processos com devedor, estado, responsável e facturas (sem N+1)' })
  @ApiSort(PROCESS_SORTABLE, 'createdAt:desc')
  @RequirePermissions(P.PROCESS_VIEW)
  index(@Query() q: ProcessListQuery) {
    return this.queries.list({ ...q, states: q.state, lastContactStatuses: q.lastContactStatus, sort: parseSort(q.sort, PROCESS_SORTABLE) });
  }

  @Get('export/pdf')
  @ApiOperation({ summary: 'Exportar em PDF os processos que correspondem aos filtros (todas as linhas que correspondem aos filtros)' })
  @RequirePermissions(P.PROCESS_VIEW)
  async exportPdf(@CurrentUser() me: AuthenticatedUser, @Query() q: ProcessListQuery) {
    const sort = parseSort(q.sort, PROCESS_SORTABLE);
    const all = await collectAllPages((page, perPage) => this.queries.list({ ...q, states: q.state, lastContactStatuses: q.lastContactStatus, sort, page, perPage }));
    const filters = activeFilters([
      ['Pesquisa', q.search], ['Estado', q.state?.length ? q.state.map((x) => STATE_LABEL[x] ?? x).join(', ') : null],
      ['Devedor', await entityName(this.ds, 'debtors', q.debtorId)], ['Agente', await entityName(this.ds, 'users', q.assignedUserId)],
      ['Responsável', q.unassigned ? 'Só sem responsável' : null], ['Situação', yesNo(q.open, 'Abertos', 'Fechados')],
      ['Criação', rangeLabel(q.createdFrom, q.createdTo)], ['Sem contacto desde', rangeLabel(q.noContactSince)?.replace('desde ', '')],
      ['Último contacto', q.lastContactStatus?.length ? q.lastContactStatus.map((x) => CONTACT_LABEL[x] ?? x).join(', ') : null],
      ['Contactos (mín.)', q.minContacts !== undefined ? String(q.minContacts) : null], ['Contactos (máx.)', q.maxContacts !== undefined ? String(q.maxContacts) : null],
    ]);
    return pdfResponse(processesPdf(all.rows, { generatedBy: await exportUserName(this.ds, me), filters, total: all.total, truncated: all.truncated }), 'processos');
  }

  @Post('assgin_user')
  @HttpCode(200)
  @RequirePermissions(P.PROCESS_ASSIGN)
  async assignUser(@Body() dto: AssignProcessDto) {
    await this.assign.execute(dto.processeId, dto.userId);
    return { message: 'Processo adicionado ao utilizador' };
  }

  @Post('assgin_user/automatic')
  @HttpCode(200)
  @ApiOperation({ summary: 'Distribuição automática (round-robin por menor carga)' })
  @RequirePermissions(P.PROCESS_ASSIGN)
  async assignAutomatic() {
    const count = await this.autoAssign.execute();
    return { message: `${count} processo(s) atribuídos`, count };
  }

  @Get('user/:userId')
  @RequirePermissions(P.PROCESS_VIEW)
  assignedTo(@Param('userId', IdPipe) userId: number, @Query() q: PaginationQueryDto) {
    return this.queries.assignedTo(userId, q);
  }

  @Get('waller/user/:userId')
  @RequirePermissions(P.WALLET_VIEW)
  wallet(@Param('userId', IdPipe) userId: number, @Query() q: PaginationQueryDto) {
    return this.queries.assignedTo(userId, q);
  }

  @Post('remove/invoice')
  @HttpCode(200)
  @Idempotent({ required: false })
  @ApiOperation({ summary: 'Retirar facturas do processo → ficam "Em disputa" (resolver em /invoice-disputes)' })
  @RequirePermissions(P.PROCESS_INVOICE_REMOVE)
  async remove(@CurrentUser() me: AuthenticatedUser, @Body() dto: RemoveInvoicesDto) {
    const n = await this.removeInvoices.execute(dto.processId, dto.invoiceIds, dto.reason, me.id);
    return { message: `${n} factura(s) removida(s) do processo`, count: n };
  }

  @Get('invoces/process/:processId')
  @RequirePermissions(P.PROCESS_VIEW)
  invoices(@Param('processId', IdPipe) processId: number, @Query() q: PaginationQueryDto) {
    return this.queries.invoicesOf(processId, q);
  }

  @Post('transfere')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({ summary: 'Transferir processos entre agentes (atómico, com lock de linha)' })
  @RequirePermissions(P.PROCESS_ASSIGN)
  async transferProcesses(@CurrentUser() me: AuthenticatedUser, @Body() dto: TransferProcessesDto) {
    const n = await this.transfer.execute({
      processIds: dto.processes.map((p) => p.processId),
      fromUserId: dto.agenteOrigemId,
      toUserId: dto.agenteDestinoId,
      reason: dto.motivoTransferencia,
      notes: dto.observacoes,
      isPermanent: dto.transferenciaDefinitiva,
      returnAt: dto.dateToRetornProcess ? new Date(dto.dateToRetornProcess) : undefined,
      performedById: me.id,
    });
    return { message: `${n} processos transferidos com sucesso` };
  }
}

@ApiTags('Contactos')
@ApiBearerAuth()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly createContact: CreateContactUseCase, private readonly history: ContactHistoryUseCase) {}

  @Post()
  @ApiOperation({ summary: 'Registar um contacto/tentativa no histórico do processo (vários por processo)' })
  @RequirePermissions(P.CONTACT_REGISTER)
  async create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateContactDto) {
    const { id } = await this.createContact.execute({ ...dto, userId: me.id });
    return { message: 'Contacto registado com sucesso', id };
  }

  @Get('process/:processId')
  @ApiSort(CONTACT_SORTABLE, 'contactedAt:desc')
  @ApiOperation({ summary: 'Histórico de contactos de um processo (mais recente primeiro)' })
  @RequirePermissions(P.PROCESS_VIEW)
  byProcess(@Param('processId', IdPipe) processId: number, @Query() q: ContactHistoryQueryDto) {
    return this.history.execute({ ...q, processId, statuses: q.status, sort: parseSort(q.sort, CONTACT_SORTABLE) });
  }

  @Get()
  @ApiSort(CONTACT_SORTABLE, 'contactedAt:desc')
  @ApiOperation({ summary: 'Contactos com filtros (ex.: produtividade de um agente: ?userId=&from=&to=)' })
  @RequirePermissions(P.PROCESS_VIEW)
  list(@Query() q: ContactHistoryQueryDto) {
    return this.history.execute({ ...q, statuses: q.status, sort: parseSort(q.sort, CONTACT_SORTABLE) });
  }
}
