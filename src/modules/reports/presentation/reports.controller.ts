import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { CollectionCostsService } from '../application/collection-costs.service';
import { agingPdf, brokenPdf, cashFlowPdf, contactsPdf, dateS, disputesPdf, kpiPdf, PdfContext } from '../application/report-pdfs';
import { ReportsService } from '../application/reports.service';
import { AGING_BUCKETS, AgingBucket, CONTACT_STATUS_LABEL, COST_CATEGORIES, COST_CATEGORY_LABEL, CostCategory } from '../domain/kpi-formulas';

const toBool = ({ value }: { value: unknown }) => (value === undefined ? undefined : value === true || value === 'true' || value === '1');
const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value);
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

class PeriodQuery {
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) agentId?: number;
  @ApiPropertyOptional({ enum: ['json', 'pdf'] }) @IsOptional() @IsIn(['json', 'pdf']) format?: 'json' | 'pdf';
}
class AgingQuery extends PeriodQuery {
  @ApiPropertyOptional({ enum: AGING_BUCKETS.map((b) => b.key) }) @IsOptional() @IsIn(AGING_BUCKETS.map((b) => b.key)) bucket?: AgingBucket;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
}
class CashFlowQuery extends PeriodQuery {
  @ApiPropertyOptional({ enum: ['week', 'month'] }) @IsOptional() @IsIn(['week', 'month']) granularity?: 'week' | 'month';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(26) periods?: number;
}
class ContactsQuery extends PeriodQuery {
  @ApiPropertyOptional({ enum: Object.keys(CONTACT_STATUS_LABEL) }) @IsOptional() @IsIn(Object.keys(CONTACT_STATUS_LABEL)) status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) contactTypeId?: number;
}
class DisputesQuery extends PeriodQuery {
  @ApiPropertyOptional({ enum: ['OPEN', 'RESOLVED'] }) @IsOptional() @IsIn(['OPEN', 'RESOLVED']) status?: 'OPEN' | 'RESOLVED';
  @ApiPropertyOptional({ default: true }) @IsOptional() @Transform(toBool) @IsBoolean() includeOpenBefore?: boolean;
}
class CostsQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage: number = 20;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
  @ApiPropertyOptional({ enum: COST_CATEGORIES }) @IsOptional() @IsIn(COST_CATEGORIES) category?: CostCategory;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
}
class CostDto {
  @ApiProperty({ format: 'date' }) @IsDateString({ strict: true }, { message: 'Data do custo inválida' }) costDate: string;
  @ApiProperty({ enum: COST_CATEGORIES }) @IsIn(COST_CATEGORIES, { message: 'Categoria inválida' }) category: CostCategory;
  @ApiProperty() @IsString() @IsNotEmpty({ message: 'Descreva o custo' }) @MaxLength(255) description: string;
  @ApiProperty({ example: '150000.00' }) @Transform(toStr) @Matches(MONEY, { message: 'Valor inválido (use até 2 casas decimais)' }) amount: string;
  @ApiPropertyOptional({ description: 'Credor a que o custo se refere (vazio = custo geral)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number | null;
}

const BUCKET_LABEL = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, b.label]));
const STATUS_LABEL_DISPUTE: Record<string, string> = { OPEN: 'Em aberto', RESOLVED: 'Resolvidas' };

@ApiTags('Estatísticas e relatórios')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly costs: CollectionCostsService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /** contexto do PDF: quem gerou + filtros legíveis */
  private async ctx(me: AuthenticatedUser, extra: Array<[string, string | null | undefined]>, ids: { organizationId?: number; agentId?: number; contactTypeId?: number }): Promise<PdfContext> {
    const [names, [u]] = await Promise.all([this.reports.filterLabels(ids), this.ds.query('SELECT coalesce(full_name, email) AS name FROM users WHERE id = $1', [me.id])]);
    const filters: Array<[string, string]> = [];
    for (const [k, v] of extra) if (v) filters.push([k, v]);
    filters.push(['Credor', names.org ?? 'Todos']);
    if (ids.agentId) filters.push(['Agente', names.agent ?? `#${ids.agentId}`]);
    if (ids.contactTypeId) filters.push(['Tipo de contacto', names.contactType ?? `#${ids.contactTypeId}`]);
    return { generatedBy: u?.name ?? me.email, filters };
  }

  private pdf(pdf: Buffer, name: string) {
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: `attachment; filename="${name}_${this.reports.today()}.pdf"`, length: pdf.length });
  }

  @Get('kpis')
  @RequirePermissions(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Indicadores de contas a receber: DSO, inadimplência, CEI, aging e custo por cobrança (+ tendência mensal)' })
  async kpis(@CurrentUser() me: AuthenticatedUser, @Query() q: PeriodQuery) {
    const data = await this.reports.kpis(q);
    if (q.format !== 'pdf') return { data };
    return this.pdf(kpiPdf(data, await this.ctx(me, [['Período', `${dateS(data.period.from)} a ${dateS(data.period.to)}`]], { organizationId: q.organizationId })), 'relatorio_contas_a_receber');
  }

  @Get('aging')
  @RequirePermissions(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Aging list detalhado (facturas em aberto hoje, por faixa de atraso)' })
  async aging(@CurrentUser() me: AuthenticatedUser, @Query() q: AgingQuery) {
    const data = await this.reports.aging(q);
    if (q.format !== 'pdf') return { data };
    return this.pdf(agingPdf(data, await this.ctx(me, [['Faixa', q.bucket ? BUCKET_LABEL[q.bucket] : 'Todas'], ['Pesquisa', q.search]], q)), 'aging_list');
  }

  @Get('cash-flow')
  @RequirePermissions(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Projecção de fluxo de caixa (prestações de acordos, facturas a vencer, pagamentos a confirmar)' })
  async cashFlow(@CurrentUser() me: AuthenticatedUser, @Query() q: CashFlowQuery) {
    const data = await this.reports.cashFlow(q);
    if (q.format !== 'pdf') return { data };
    return this.pdf(cashFlowPdf(data, await this.ctx(me, [['Horizonte', `${data.periods.length} ${q.granularity === 'month' ? 'meses' : 'semanas'}`]], q)), 'projecao_fluxo_caixa');
  }

  @Get('contacts')
  @RequirePermissions(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Histórico de contactos (por defeito: últimos 30 dias)' })
  async contacts(@CurrentUser() me: AuthenticatedUser, @Query() q: ContactsQuery) {
    const data = await this.reports.contacts(q);
    if (q.format !== 'pdf') return { data };
    return this.pdf(contactsPdf(data, await this.ctx(me, [['Período', `${dateS(data.period.from)} a ${dateS(data.period.to)}`], ['Resultado', q.status ? CONTACT_STATUS_LABEL[q.status] : null]], q)), 'historico_contactos');
  }

  @Get('broken-agreements')
  @RequirePermissions(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Acordos quebrados no período' })
  async broken(@CurrentUser() me: AuthenticatedUser, @Query() q: PeriodQuery) {
    const data = await this.reports.brokenAgreements(q);
    if (q.format !== 'pdf') return { data };
    return this.pdf(brokenPdf(data, await this.ctx(me, [['Período', `${dateS(data.period.from)} a ${dateS(data.period.to)}`]], q)), 'acordos_quebrados');
  }

  @Get('disputes')
  @RequirePermissions(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Disputas e contestações (abertas ou resolvidas no período + as que continuam abertas)' })
  async disputes(@CurrentUser() me: AuthenticatedUser, @Query() q: DisputesQuery) {
    const data = await this.reports.disputes(q);
    if (q.format !== 'pdf') return { data };
    return this.pdf(disputesPdf(data, await this.ctx(me, [['Período', `${dateS(data.period.from)} a ${dateS(data.period.to)}`], ['Estado', q.status ? STATUS_LABEL_DISPUTE[q.status] : null]], q)), 'disputas');
  }

  /* ───────── custos ───────── */
  @Get('costs/categories')
  @RequirePermissions(P.REPORTS_VIEW)
  categories() {
    return { data: COST_CATEGORIES.map((c) => ({ value: c, label: COST_CATEGORY_LABEL[c] })) };
  }

  @Get('costs')
  @RequirePermissions(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Custos da operação de cobrança' })
  listCosts(@Query() q: CostsQuery) {
    return this.costs.list(q);
  }

  @Post('costs')
  @RequirePermissions(P.REPORTS_COST_MANAGE)
  async createCost(@CurrentUser() me: AuthenticatedUser, @Body() dto: CostDto) {
    return { message: 'Custo registado', data: await this.costs.create(dto, me.id) };
  }

  @Put('costs/:id')
  @RequirePermissions(P.REPORTS_COST_MANAGE)
  async updateCost(@Param('id', ParseIntPipe) id: number, @Body() dto: CostDto) {
    return { message: 'Custo actualizado', data: await this.costs.update(id, dto) };
  }

  @Delete('costs/:id')
  @HttpCode(200)
  @RequirePermissions(P.REPORTS_COST_MANAGE)
  async deleteCost(@Param('id', ParseIntPipe) id: number) {
    await this.costs.remove(id);
    return { message: 'Custo removido' };
  }
}
