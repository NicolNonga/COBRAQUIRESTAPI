import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import * as C from '../application/ladder-commands.use-cases';
import { LadderQueriesUseCase } from '../application/ladder-queries.use-cases';
import { RunCollectionLaddersUseCase } from '../application/run-ladders.use-case';
import { DEBTOR_CHANNELS, LADDER_ACTIONS, LADDER_RECIPIENTS, TEMPLATE_VARIABLES } from '../domain/ladder';
import { PolicyQueriesUseCase, UpdatePolicyUseCase } from '../application/policy.use-cases';
import { CreateLadderDto, ListLaddersQuery, UpdateLadderDto, UpdatePolicyDto } from './dto/ladder.dto';
import { P } from '@/modules/access-control/domain/permission-catalog';

@ApiTags('Régua master')
@ApiBearerAuth()
@Controller('collection-policy')
export class CollectionPolicyController {
  constructor(private readonly queries: PolicyQueriesUseCase, private readonly update: UpdatePolicyUseCase) {}

  @Get()
  @ApiOperation({ summary: 'A régua master: limites que todas as réguas têm de cumprir (lida por quem cria réguas)' })
  @RequirePermissions(P.LADDER_VIEW)
  async show() {
    return { data: await this.queries.get() };
  }

  @Put()
  @ApiOperation({ summary: 'Alterar a régua master (revalida e suspende as réguas que deixarem de cumprir)' })
  @RequirePermissions(P.POLICY_MANAGE)
  async edit(@CurrentUser() me: AuthenticatedUser, @Body() dto: UpdatePolicyDto) {
    const { expectedVersion, ...rest } = dto;
    const r = await this.update.execute(me, expectedVersion, {
      ...rest,
      description: rest.description ?? null,
      maxContactsPerProcess: rest.maxContactsPerProcess ?? null,
      rules: rest.rules.map((x) => ({ ...x, maxFulfillmentDays: x.maxFulfillmentDays ?? null })),
    });
    const extra = r.suspended ? ` ${r.suspended} régua(s) deixaram de cumprir e foram suspensas.` : '';
    return { message: `Régua master actualizada.${extra}`, ...r };
  }
}

@ApiTags('Régua de cobrança')
@ApiBearerAuth()
@Controller('collection-ladders')
export class CollectionLaddersController {
  constructor(
    private readonly create: C.CreateLadderUseCase,
    private readonly update: C.UpdateLadderUseCase,
    private readonly setActive: C.SetLadderActiveUseCase,
    private readonly archive: C.ArchiveLadderUseCase,
    private readonly queries: LadderQueriesUseCase,
    private readonly run: RunCollectionLaddersUseCase,
    private readonly cfg: ConfigService,
  ) {}

  @Get('options')
  @ApiOperation({ summary: 'Acções, destinatários e variáveis disponíveis para montar uma régua' })
  @RequirePermissions(P.LADDER_VIEW)
  options() {
    return {
      data: {
        actions: LADDER_ACTIONS,
        recipients: LADDER_RECIPIENTS,
        variables: TEMPLATE_VARIABLES,
        debtorChannels: DEBTOR_CHANNELS,
        /** log = mensagens ao devedor ficam só nos logs (testes); send = email real (SMS ainda sem fornecedor) */
        debtorMessagesMode: this.cfg.get<string>('DEBTOR_MESSAGES_MODE', 'log'),
      },
    };
  }

  @Post()
  @ApiOperation({ summary: 'Criar a minha régua (nasce inactiva)' })
  @RequirePermissions(P.LADDER_MANAGE)
  async store(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateLadderDto) {
    const { id } = await this.create.execute(me, dto);
    return { message: 'Régua criada. Reveja com /preview e active-a.', id };
  }

  @Get()
  @ApiOperation({ summary: 'As minhas réguas (gestor: ?ownerId= de um comercial da equipa)' })
  @RequirePermissions(P.LADDER_VIEW)
  index(@CurrentUser() me: AuthenticatedUser, @Query() q: ListLaddersQuery) {
    return this.queries.list(me, q.ownerId, q.includeArchived === 'true', q.page, q.perPage);
  }

  @Get(':id')
  @RequirePermissions(P.LADDER_VIEW)
  async show(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    return { data: await this.queries.get(me, id) };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Editar régua e etapas (lock optimista por versão)' })
  @RequirePermissions(P.LADDER_MANAGE)
  async edit(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() dto: UpdateLadderDto) {
    const { version } = await this.update.execute(me, id, dto.expectedVersion, dto);
    return { message: 'Régua actualizada', version };
  }

  @Get(':id/coverage')
  @RequirePermissions(P.LADDER_VIEW)
  async coverage(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    return { data: await this.queries.coverage(me, id) };
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Simular: o que a régua faria hoje nos meus processos (não grava nem envia)' })
  @RequirePermissions(P.LADDER_VIEW)
  async preview(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    return { data: await this.queries.preview(me, id) };
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activar (desactiva a régua activa anterior)' })
  @RequirePermissions(P.LADDER_MANAGE)
  async activate(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    await this.setActive.execute(me, id, true);
    return { message: 'Régua activada' };
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(P.LADDER_MANAGE)
  async deactivate(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    await this.setActive.execute(me, id, false);
    return { message: 'Régua desactivada' };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(P.LADDER_MANAGE)
  async archiveOne(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    await this.archive.execute(me, id);
    return { message: 'Régua arquivada' };
  }

  @Post('run')
  @HttpCode(200)
  @RequirePermissions('collection_ladder_run_permission')
  @ApiOperation({ summary: 'Executar o motor agora (admin; normalmente corre pelo job diário)' })
  async runNow() {
    return { data: await this.run.execute() };
  }
}
