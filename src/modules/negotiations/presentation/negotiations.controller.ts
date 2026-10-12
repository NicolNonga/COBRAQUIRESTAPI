import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Idempotent } from '@/infrastructure/idempotency/idempotent.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { ApiSort, parseSort } from '@/shared/presentation/criteria-query.dto';
import { NEGOTIATION_SORTABLE } from '../domain/negotiation.repository';
import { CancelNegotiationUseCase } from '../application/cancel-negotiation.use-case';
import * as L from '../application/negotiation-lifecycle.use-cases';
import { RenegotiateUseCase, RenegotiationBalanceUseCase } from '../application/renegotiate.use-case';
import { CreateNegotiationUseCase } from '../application/create-negotiation.use-case';
import { NegotiationQueriesUseCase } from '../application/negotiation-queries.use-case';
import { NegotiationSimulatorUseCase } from '../application/negotiation-simulator.use-case';
import {
  CancelNegotiationDto,
  ReasonDto,
  RenegotiateDto,
  CreateNegotiationDto,
  ListNegotiationsQuery,
  SimulateInstallmentsDto,
  SimulateOverdueDto,
  SimulateValuesDto,
} from './dto/negotiation.dto';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { collectAllPages } from '@/shared/application/export-all';
import { activeFilters, entityName, exportUserName, pdfResponse, rangeLabel, yesNo } from '@/shared/presentation/pdf-export';
import { negotiationsPdf, NEGOTIATION_LABEL } from '@/modules/reports/application/list-pdfs';
import { InvoiceStateCode } from '@/modules/catalogs/domain/state-catalog.port';
import { PaginationQueryDto } from '@/shared/presentation/pagination.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

class NegotiationInvoicesQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStateCode, description: 'Filtrar por estado da factura' })
  @IsOptional() @IsIn(Object.values(InvoiceStateCode))
  state?: InvoiceStateCode;
}

@ApiTags('Negociações')
@ApiBearerAuth()
@Controller('negotiations')
export class NegotiationsController {
  constructor(
    private readonly create: CreateNegotiationUseCase,
    private readonly cancel: CancelNegotiationUseCase,
    private readonly queries: NegotiationQueriesUseCase,
    private readonly simulator: NegotiationSimulatorUseCase,
    private readonly approve: L.ApproveNegotiationUseCase,
    private readonly reject: L.RejectNegotiationUseCase,
    private readonly breakOne: L.BreakNegotiationUseCase,
    private readonly balance: RenegotiationBalanceUseCase,
    private readonly renegotiate: RenegotiateUseCase,
    private readonly cfg: ConfigService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Post()
  @Idempotent() // Idempotency-Key obrigatório: um duplo clique não cria dois acordos
  @ApiOperation({ summary: 'Criar negociação (atómica, valida dívida real dos processos, locks de linha)' })
  @RequirePermissions(P.NEGOTIATION_CREATE)
  async store(@CurrentUser() me: AuthenticatedUser, @Body() d: CreateNegotiationDto) {
    const neg = await this.create.execute(
      {
        debtAmount: d.debtAmount,
        discountAmount: d.discountAmount,
        discountRate: d.discountRate,
        totalAmount: d.totalAmount,
        finalAmount: d.finalAmount,
        effectiveDate: d.effectiveDate,
        startDate: d.startDate,
        endDate: d.endDate,
        isInstallment: d.isInstallmentment,
        isEqualInstallments: d.isParcelaIgual,
        totalInstallments: d.totalInstallments ?? null,
        processIds: d.processes.map((p) => p.id),
        notes: d.notes,
        installments: d.installmentments?.map((p) => ({
          installmentNumber: p.installmentNumber,
          amount: p.installmentAmount,
          percentage: p.installmentPercentage,
          dueDate: p.dueDate,
          penaltyPercentage: p.penaltyPercentage,
        })),
      },
      me.id,
    );
    return { message: 'Negociação criada com sucesso', data: await this.queries.byId(neg.id) };
  }

  @Get()
  @ApiOperation({ summary: 'Listar negociações (search: devedor/NIF)', description: `Ordenação: ${NEGOTIATION_SORTABLE.join(', ')}` })
  @ApiSort(NEGOTIATION_SORTABLE, 'createdAt:desc')
  @RequirePermissions(P.NEGOTIATION_VIEW)
  index(@Query() q: ListNegotiationsQuery) {
    return this.queries.list({ ...q, statuses: q.status, sort: parseSort(q.sort, NEGOTIATION_SORTABLE) });
  }

  @Get('export/pdf')
  @ApiOperation({ summary: 'Exportar em PDF as negociações que correspondem aos filtros (todas as linhas que correspondem aos filtros)' })
  @RequirePermissions(P.NEGOTIATION_VIEW)
  async exportPdf(@CurrentUser() me: AuthenticatedUser, @Query() q: ListNegotiationsQuery) {
    const sort = parseSort(q.sort, NEGOTIATION_SORTABLE);
    const all = await collectAllPages((page, perPage) => this.queries.list({ ...q, statuses: q.status, sort, page, perPage }));
    const filters = activeFilters([
      ['Pesquisa', q.search], ['Estado', q.status?.length ? q.status.map((x) => NEGOTIATION_LABEL[x] ?? x).join(', ') : null],
      ['Devedor', await entityName(this.ds, 'debtors', q.debtorId)], ['Criado por', await entityName(this.ds, 'users', q.createdById)],
      ['Modalidade', yesNo(q.isInstallment, 'Em prestações', 'Pagamento único')],
      ['Dívida mínima', q.minTotal], ['Dívida máxima', q.maxTotal], ['Data efectiva', rangeLabel(q.effectiveFrom, q.effectiveTo)],
    ]);
    return pdfResponse(negotiationsPdf(all.rows, { generatedBy: await exportUserName(this.ds, me), filters, total: all.total, truncated: all.truncated }), 'negociacoes');
  }

  @Post('calculate-values')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simular desconto e total' })
  @RequirePermissions(P.NEGOTIATION_CREATE)
  values(@Body() d: SimulateValuesDto) {
    return { data: this.simulator.values(d.debtAmount, d.discountRate) };
  }

  @Post('generate-installments')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simular prestações (soma sempre exacta)' })
  @RequirePermissions(P.NEGOTIATION_CREATE)
  installments(@Body() d: SimulateInstallmentsDto) {
    return { data: this.simulator.installments(d) };
  }

  @Post('calculate-overdue')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simular multa + juros compostos de prestação em atraso' })
  @RequirePermissions(P.NEGOTIATION_CREATE)
  overdue(@Body() d: SimulateOverdueDto) {
    return { data: this.simulator.overdue(d) };
  }

  @Get('settings')
  @ApiOperation({ summary: 'Limites usados nos acordos (multa máxima, desconto sem aprovação, base)' })
  @RequirePermissions(P.NEGOTIATION_VIEW)
  settings() {
    return {
      data: {
        maxPenaltyPercent: String(this.cfg.get('MAX_PENALTY_PERCENT', 2)),
        approvalDiscountLimitPercent: String(this.cfg.get('NEGOTIATION_APPROVAL_DISCOUNT_LIMIT_PERCENT', 10)),
        lateMonthlyInterestPercent: String(this.cfg.get('NEGOTIATION_LATE_MONTHLY_INTEREST_PERCENT', 1)),
      },
    };
  }

  @Get(':id')
  @RequirePermissions(P.NEGOTIATION_VIEW)
  @ApiOperation({ summary: 'Detalhe: prestações (pago / em falta), processos e resumo das facturas por processo (lista em /:id/invoices)' })
  async show(@Param('id', IdPipe) id: number) {
    return { data: await this.queries.byId(id) };
  }

  @Get(':id/invoices')
  @RequirePermissions(P.NEGOTIATION_VIEW)
  @ApiOperation({ summary: 'Facturas dos processos do acordo, paginadas (ordem: vencimento)' })
  invoices(@Param('id', IdPipe) id: number, @Query() q: NegotiationInvoicesQuery) {
    return this.queries.invoices(id, q.page, q.perPage, q.state);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent({ required: false })
  @RequirePermissions(P.NEGOTIATION_CANCEL)
  async cancelOne(@Param('id', IdPipe) id: number, @Body() d: CancelNegotiationDto) {
    await this.cancel.execute(id, d.reason);
    return { message: 'Negociação cancelada' };
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprovar (gestor de quem criou ou permissão negotiation_approve_permission; nunca quem criou)' })
  async approveOne(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    await this.approve.execute(me, id);
    return { message: 'Negociação aprovada e em vigor' };
  }

  @Post(':id/reject')
  @HttpCode(200)
  async rejectOne(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() d: ReasonDto) {
    await this.reject.execute(me, id, d.reason);
    return { message: 'Negociação rejeitada; processos libertados' };
  }

  @Post(':id/break')
  @HttpCode(200)
  @RequirePermissions('negotiation_break_permission')
  @ApiOperation({ summary: 'Quebrar o acordo manualmente (liberta os processos para renegociação)' })
  async breakNegotiation(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() d: ReasonDto) {
    await this.breakOne.execute(me, id, d.reason);
    return { message: 'Acordo quebrado' };
  }

  @Get(':id/renegotiation-balance')
  @ApiOperation({ summary: 'Saldo para renegociar: capital em aberto + multa + juros, por prestação' })
  @RequirePermissions(P.NEGOTIATION_VIEW)
  async renegotiationBalance(@Param('id', IdPipe) id: number) {
    return { data: await this.balance.execute(id) };
  }

  @Post(':id/renegotiate')
  @Idempotent()
  @ApiOperation({ summary: 'Renegociar (atómico): o saldo de abertura é calculado no servidor; aprovação só acima do limite' })
  @RequirePermissions(P.NEGOTIATION_CREATE)
  async renegotiateOne(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() d: RenegotiateDto) {
    const r = await this.renegotiate.execute(
      id,
      {
        discountAmount: d.discountAmount,
        discountRate: d.discountRate,
        totalAmount: d.totalAmount,
        finalAmount: d.finalAmount,
        effectiveDate: d.effectiveDate,
        startDate: d.startDate,
        endDate: d.endDate,
        isInstallment: d.isInstallmentment,
        isEqualInstallments: d.isParcelaIgual,
        totalInstallments: d.totalInstallments ?? null,
        notes: d.notes,
        installments: d.installmentments?.map((p) => ({
          installmentNumber: p.installmentNumber,
          amount: p.installmentAmount,
          percentage: p.installmentPercentage,
          dueDate: p.dueDate,
          penaltyPercentage: p.penaltyPercentage,
        })),
      },
      me.id,
    );
    return {
      message: r.status === 'PENDING_APPROVAL' ? 'Renegociação criada; aguarda aprovação' : 'Renegociação criada e em vigor',
      data: { ...r, negotiation: await this.queries.byId(r.id) },
    };
  }
}
