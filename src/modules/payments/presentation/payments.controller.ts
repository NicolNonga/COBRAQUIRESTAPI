import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Idempotent } from '@/infrastructure/idempotency/idempotent.decorator';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { ValidationError } from '@/shared/domain/errors';
import { ApiSort, parseSort } from '@/shared/presentation/criteria-query.dto';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { assertFileType, IMAGE_TYPES, PDF_TYPES, toBinary } from '@/shared/presentation/upload';
import { PAYMENT_METHOD_MANAGE_PERMISSION } from '../application/payment-authority';
import { CurrenciesAdminUseCase, PaymentMethodsUseCase } from '../application/payment-catalog.use-cases';
import { CancelPaymentUseCase, ConfirmPaymentUseCase, ReversePaymentUseCase } from '../application/payment-decision.use-cases';
import { PaymentQueriesUseCase } from '../application/payment-queries.use-case';
import { RegisterPaymentUseCase } from '../application/register-payment.use-case';
import { PAYMENT_SORTABLE } from '../domain/payment.repository';
import {
  ActiveFilterQuery,
  CreateCurrencyDto,
  CreatePaymentMethodDto,
  ListPaymentsQuery,
  PageQuery,
  ReasonDto,
  RegisterPaymentDto,
  UpdateCurrencyDto,
  UpdatePaymentMethodDto,
} from './dto/payment.dto';
import { P } from '@/modules/access-control/domain/permission-catalog';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { collectAllPages } from '@/shared/application/export-all';
import { activeFilters, entityName, exportUserName, pdfResponse, rangeLabel, yesNo } from '@/shared/presentation/pdf-export';
import { paymentsPdf, PAYMENT_LABEL } from '@/modules/reports/application/list-pdfs';

const PROOF_TYPES = { ...PDF_TYPES, ...IMAGE_TYPES };

@ApiTags('Pagamentos')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly register: RegisterPaymentUseCase,
    private readonly confirm: ConfirmPaymentUseCase,
    private readonly cancel: CancelPaymentUseCase,
    private readonly reverse: ReversePaymentUseCase,
    private readonly queries: PaymentQueriesUseCase,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Post()
  @Idempotent() // Idempotency-Key obrigatório: duplo clique/retry não regista o pagamento duas vezes
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('proof'))
  @ApiOperation({ summary: 'Registar pagamento com comprovativo (fica PENDING até confirmação)' })
  @RequirePermissions(P.PAYMENT_REGISTER)
  async store(@CurrentUser() me: AuthenticatedUser, @Body() d: RegisterPaymentDto, @UploadedFile() proof?: Express.Multer.File) {
    if (!proof) throw new ValidationError('O comprovativo é obrigatório (campo "proof")');
    assertFileType(proof, PROOF_TYPES);
    const r = await this.register.execute(
      {
        negotiationId: d.negotiationId,
        installmentId: d.installmentId ?? null,
        receiver: d.receiver,
        amount: d.amount,
        currencyId: d.currencyId,
        exchangeRate: d.exchangeRate,
        paymentMethodId: d.paymentMethodId,
        paidOn: d.paidOn,
        reference: d.reference,
        notes: d.notes,
        proof: toBinary(proof),
      },
      me.id,
    );
    return { message: 'Pagamento registado; aguarda confirmação', data: r };
  }

  @Get()
  @ApiOperation({ summary: 'Listar pagamentos (search: devedor/referência)' })
  @ApiSort(PAYMENT_SORTABLE, 'createdAt:desc')
  @RequirePermissions(P.PAYMENT_VIEW)
  index(@Query() q: ListPaymentsQuery) {
    return this.queries.list({ ...q, statuses: q.status, sort: parseSort(q.sort, PAYMENT_SORTABLE) });
  }

  @Get('export/pdf')
  @ApiOperation({ summary: 'Exportar em PDF os pagamentos que correspondem aos filtros (todas as linhas que correspondem aos filtros)' })
  @RequirePermissions(P.PAYMENT_VIEW)
  async exportPdf(@CurrentUser() me: AuthenticatedUser, @Query() q: ListPaymentsQuery) {
    const sort = parseSort(q.sort, PAYMENT_SORTABLE);
    const all = await collectAllPages((page, perPage) => this.queries.list({ ...q, statuses: q.status, sort, page, perPage }));
    const ids = [...new Set(all.rows.map((p) => p.debtorId))];
    const names: Array<{ id: number; name: string }> = ids.length ? await this.ds.query('SELECT id, name FROM debtors WHERE id = ANY($1::int[])', [ids]) : [];
    const filters = activeFilters([
      ['Pesquisa', q.search], ['Estado', q.status?.length ? q.status.map((x) => PAYMENT_LABEL[x] ?? x).join(', ') : null],
      ['Recebido por', q.receiver === 'AGENCY' ? 'Agência' : q.receiver === 'CREDITOR' ? 'Credor' : null],
      ['Devedor', await entityName(this.ds, 'debtors', q.debtorId)], ['Credor', await entityName(this.ds, 'organizations', q.organizationId)],
      ['Registado por', await entityName(this.ds, 'users', q.registeredById)], ['Acordo', q.negotiationId ? `ACD-${String(q.negotiationId).padStart(5, '0')}` : null],
      ['Data do pagamento', rangeLabel(q.paidFrom, q.paidTo)], ['Valor mínimo', q.minAmount], ['Valor máximo', q.maxAmount],
    ]);
    const pdf = paymentsPdf(all.rows, { generatedBy: await exportUserName(this.ds, me), filters, total: all.total, truncated: all.truncated, debtorNames: Object.fromEntries(names.map((d) => [d.id, d.name])) });
    return pdfResponse(pdf, 'pagamentos');
  }

  @Get('pending-confirmation')
  @ApiOperation({ summary: 'Fila de confirmação: financeiro vê todos; gestor vê os da sua carteira (mais antigos primeiro)' })
  @ApiSort(PAYMENT_SORTABLE, 'createdAt:asc')
  @RequirePermissions(P.PAYMENT_VIEW)
  pending(@CurrentUser() me: AuthenticatedUser, @Query() q: ListPaymentsQuery) {
    return this.queries.pendingQueue(me, { ...q, sort: parseSort(q.sort, PAYMENT_SORTABLE) });
  }

  @Get('debtor-credit/:debtorId')
  @ApiOperation({ summary: 'Crédito do devedor (excedentes de pagamentos): saldo + movimentos' })
  @RequirePermissions(P.PAYMENT_VIEW)
  async debtorCredit(@Param('debtorId', IdPipe) debtorId: number, @Query() q: PageQuery) {
    return { data: await this.queries.debtorCredit(debtorId, q.page, q.perPage) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do pagamento, com a alocação por prestação' })
  @RequirePermissions(P.PAYMENT_VIEW)
  async show(@Param('id', IdPipe) id: number) {
    return { data: await this.queries.byId(String(id)) };
  }

  @Get(':id/proof')
  @ApiOperation({ summary: 'Descarregar o comprovativo' })
  @RequirePermissions(P.PAYMENT_VIEW)
  async proof(@Param('id', IdPipe) id: number, @Res() res: Response) {
    res.download(await this.queries.proofPath(String(id)));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Idempotent({ required: false })
  @ApiOperation({ summary: 'Confirmar (comprovativo validado): aloca às prestações, comissão, conta-corrente e fecho automático do processo' })
  @RequirePermissions(P.PAYMENT_VIEW)
  async confirmOne(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    return { message: 'Pagamento confirmado', data: await this.confirm.execute(me, String(id)) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Anular pagamento PENDENTE (motivo obrigatório). Nada é apagado.' })
  @RequirePermissions(P.PAYMENT_VIEW)
  async cancelOne(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() d: ReasonDto) {
    await this.cancel.execute(me, String(id), d.reason);
    return { message: 'Pagamento anulado' };
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @Idempotent({ required: false })
  @ApiOperation({ summary: 'Estornar pagamento CONFIRMADO (motivo obrigatório): reabre prestações/acordo e anula lançamentos' })
  @RequirePermissions(P.PAYMENT_VIEW)
  async reverseOne(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() d: ReasonDto) {
    return { message: 'Pagamento estornado', data: await this.reverse.execute(me, String(id), d.reason) };
  }
}

@ApiTags('Pagamentos — configuração')
@ApiBearerAuth()
@Controller()
export class PaymentSettingsController {
  constructor(private readonly methods: PaymentMethodsUseCase, private readonly currencies: CurrenciesAdminUseCase) {}

  @Get('payment-methods')
  @ApiOperation({ summary: 'Meios de pagamento (para escolher no registo)' })
  async listMethods(@Query() q: ActiveFilterQuery) {
    return { data: await this.methods.list(q.onlyActive ?? true) };
  }

  @Post('payment-methods')
  @RequirePermissions(PAYMENT_METHOD_MANAGE_PERMISSION)
  async createMethod(@Body() d: CreatePaymentMethodDto) {
    return { message: 'Meio de pagamento criado', data: await this.methods.create(d) };
  }

  @Patch('payment-methods/:id')
  @RequirePermissions(PAYMENT_METHOD_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Editar/desactivar meio de pagamento (não se apaga)' })
  async updateMethod(@Param('id', IdPipe) id: number, @Body() d: UpdatePaymentMethodDto) {
    await this.methods.update(id, d);
    return { message: 'Meio de pagamento actualizado' };
  }

  @Get('payment-currencies')
  @ApiOperation({ summary: 'Moedas aceites no registo de pagamentos' })
  async listCurrencies(@Query() q: ActiveFilterQuery) {
    return { data: await this.currencies.list(q.onlyActive ?? true) };
  }

  @Post('payment-currencies')
  @RequirePermissions(PAYMENT_METHOD_MANAGE_PERMISSION)
  async createCurrency(@Body() d: CreateCurrencyDto) {
    return { message: 'Moeda criada', data: await this.currencies.create(d) };
  }

  @Patch('payment-currencies/:id')
  @RequirePermissions(PAYMENT_METHOD_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Editar/desactivar moeda (o código ISO não muda)' })
  async updateCurrency(@Param('id', IdPipe) id: number, @Body() d: UpdateCurrencyDto) {
    await this.currencies.update(id, d);
    return { message: 'Moeda actualizada' };
  }
}
