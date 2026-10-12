import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { PaginationQueryDto } from '@/shared/presentation/pagination.dto';
import {
  GetIntegrationUseCase,
  SetIntegrationCredentialsUseCase,
  SetIntegrationStatusUseCase,
  TestIntegrationUseCase,
  UpdateIntegrationUseCase,
} from '../application/integration-settings.use-cases';
import { IntegrationQueriesUseCase, ResolveReviewUseCase } from '../application/integration-reviews.use-cases';
import { RunSyncUseCase } from '../application/run-sync.use-case';
import { ListReviewsQuery, ResolveReviewDto, SetCredentialsDto, StartRunDto, UpdateIntegrationDto } from './dto/integration.dto';

/** A ligação ao ERP (SAP) — uma só para toda a aplicação. */
@ApiTags('Integração com o ERP')
@ApiBearerAuth()
@Controller('integration')
export class IntegrationController {
  constructor(
    private readonly getOne: GetIntegrationUseCase,
    private readonly updateOne: UpdateIntegrationUseCase,
    private readonly credentials: SetIntegrationCredentialsUseCase,
    private readonly tester: TestIntegrationUseCase,
    private readonly status: SetIntegrationStatusUseCase,
    private readonly sync: RunSyncUseCase,
    private readonly queries: IntegrationQueriesUseCase,
    private readonly resolver: ResolveReviewUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Configuração, estado e última execução (sem credenciais)' })
  @RequirePermissions(P.INTEGRATION_VIEW)
  async show() {
    return { data: await this.getOne.execute() };
  }

  @Put()
  @ApiOperation({ summary: 'Configurar: fornecedor, ligação, opções, intervalo e empresas do ERP → credores' })
  @RequirePermissions(P.INTEGRATION_MANAGE)
  async update(@CurrentUser() me: AuthenticatedUser, @Body() dto: UpdateIntegrationDto) {
    await this.updateOne.execute(me, dto);
    return { message: 'Configuração da integração gravada.', data: await this.getOne.execute() };
  }

  @Put('credentials')
  @ApiOperation({ summary: 'Gravar as credenciais do ERP (cifradas; nunca são devolvidas)' })
  @RequirePermissions(P.INTEGRATION_MANAGE)
  async setCredentials(@CurrentUser() me: AuthenticatedUser, @Body() dto: SetCredentialsDto) {
    const r = await this.credentials.execute(me, dto.credentials);
    return { message: r.hasCredentials ? 'Credenciais gravadas.' : 'Credenciais apagadas.', data: r };
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Testar a ligação: empresas visíveis e facturas em aberto' })
  @RequirePermissions(P.INTEGRATION_MANAGE)
  async test() {
    return { data: await this.tester.execute() };
  }

  @Post('activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activar a sincronização automática' })
  @RequirePermissions(P.INTEGRATION_MANAGE)
  async activate(@CurrentUser() me: AuthenticatedUser) {
    await this.status.activate(me);
    return { message: 'Integração activada. A primeira sincronização começa dentro de minutos.', data: await this.getOne.execute() };
  }

  @Post('pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pausar a sincronização automática' })
  @RequirePermissions(P.INTEGRATION_MANAGE)
  async pause(@CurrentUser() me: AuthenticatedUser) {
    await this.status.pause(me);
    return { message: 'Integração pausada.', data: await this.getOne.execute() };
  }

  @Post('runs')
  @HttpCode(202)
  @ApiOperation({ summary: 'Sincronizar agora (DELTA, FULL ou DRY_RUN = simulação). Responde logo; acompanhe em GET /integration/runs/:id' })
  @RequirePermissions(P.INTEGRATION_MANAGE)
  async run(@CurrentUser() me: AuthenticatedUser, @Body() dto: StartRunDto) {
    const r = await this.sync.launch({ trigger: 'MANUAL', mode: dto.mode, userId: me.id });
    return { message: dto.mode === 'DRY_RUN' ? 'Simulação iniciada: nada será gravado.' : 'Sincronização iniciada.', data: r };
  }

  @Get('runs')
  @ApiOperation({ summary: 'Histórico de execuções' })
  @RequirePermissions(P.INTEGRATION_VIEW)
  runs(@Query() q: PaginationQueryDto) {
    return this.queries.listRuns(q);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Detalhe de uma execução, com o relatório (na simulação: tudo o que faria)' })
  @RequirePermissions(P.INTEGRATION_VIEW)
  async runDetail(@Param('id', IdPipe) id: number) {
    return { data: await this.queries.run(id) };
  }

  @Get('reviews')
  @ApiOperation({ summary: 'Fila de revisão: casos que a integração não decide sozinha' })
  @RequirePermissions(P.INTEGRATION_VIEW)
  reviews(@Query() q: ListReviewsQuery) {
    const { status, kind, ...page } = q;
    return this.queries.listReviews({ status, kind }, page);
  }

  @Post('reviews/:id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tratar um caso: RESOLVE, IGNORE ou CLOSE_PROCESS (processo pronto a fechar)' })
  @RequirePermissions(P.INTEGRATION_REVIEW)
  async resolve(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() dto: ResolveReviewDto) {
    const r = await this.resolver.execute(me, id, dto.action, dto.note ?? '');
    return { message: dto.action === 'CLOSE_PROCESS' ? 'Processo fechado.' : 'Caso tratado.', data: r };
  }
}
