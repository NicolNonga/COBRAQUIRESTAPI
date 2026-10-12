import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { Idempotent } from '@/infrastructure/idempotency/idempotent.decorator';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { FileStorage } from '@/shared/application/file-storage.port';
import { ValidationError } from '@/shared/domain/errors';
import { ApiSort, ListQueryDto, parseSort } from '@/shared/presentation/criteria-query.dto';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import { assertFileType, IMAGE_TYPES, PDF_TYPES, toBinary } from '@/shared/presentation/upload';
import * as U from '../application/creditor-accounts.use-cases';
import { SETTLEMENT_DIRECTIONS, SETTLEMENT_SORTABLE, SETTLEMENT_STATUSES, SettlementDirection, SettlementStatus } from '../domain/settlement';
import { P } from '@/modules/access-control/domain/permission-catalog';

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value);
const BALANCE_SORTABLE = ['organizationName'] as const;

class BalancesQuery extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
}

class StatementQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) perPage: number = 20;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
}

class CommissionRateDto {
  @ApiProperty({ example: '10.00', description: 'Percentagem (0–100) sobre o valor recuperado e confirmado' })
  @Transform(toStr) @Matches(/^\d{1,3}(\.\d{1,2})?$/)
  rate: string;
}

class RegisterSettlementDto {
  @ApiProperty({ enum: SETTLEMENT_DIRECTIONS, description: 'TO_CREDITOR = repasse ao credor (B); FROM_CREDITOR = credor paga-nos a comissão (A)' })
  @IsIn(SETTLEMENT_DIRECTIONS)
  direction: SettlementDirection;
  @ApiProperty({ example: '90000.00' }) @Transform(toStr) @Matches(MONEY) amount: string;
  @ApiProperty({ format: 'date' }) @IsDateString({ strict: true }) settledOn: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) paymentMethodId: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiProperty({ type: 'string', format: 'binary', description: 'Comprovativo (PDF, PNG ou JPG) — obrigatório' }) proof: unknown;
}

class ListSettlementsQuery extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
  @ApiPropertyOptional({ enum: SETTLEMENT_DIRECTIONS }) @IsOptional() @IsIn(SETTLEMENT_DIRECTIONS) direction?: SettlementDirection;
  @ApiPropertyOptional({ enum: SETTLEMENT_STATUSES, isArray: true, example: 'PENDING' })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim().toUpperCase()))
  @IsIn(SETTLEMENT_STATUSES, { each: true })
  status?: SettlementStatus[];
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) settledFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) settledTo?: string;
}

class ReasonDto {
  @ApiProperty({ minLength: 5 }) @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}

@ApiTags('Conta-corrente dos credores')
@ApiBearerAuth()
@Controller('creditor-accounts')
export class CreditorAccountsController {
  constructor(
    private readonly queries: U.CreditorAccountQueriesUseCase,
    private readonly setRate: U.SetCommissionRateUseCase,
    private readonly registerSettlement: U.RegisterSettlementUseCase,
    private readonly confirmSettlement: U.ConfirmSettlementUseCase,
    private readonly cancelSettlement: U.CancelSettlementUseCase,
    private readonly storage: FileStorage,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Saldos por credor: > 0 devemos (repassar); < 0 o credor deve-nos (comissões)' })
  @ApiSort(BALANCE_SORTABLE, 'organizationName:asc')
  @RequirePermissions(P.CREDITOR_ACCOUNT_VIEW)
  balances(@Query() q: BalancesQuery) {
    return this.queries.balances({ ...q, sort: parseSort(q.sort, BALANCE_SORTABLE) });
  }

  @Get('settlements')
  @ApiOperation({ summary: 'Acertos (repasses e recebimentos de comissão)' })
  @ApiSort(SETTLEMENT_SORTABLE, 'createdAt:desc')
  @RequirePermissions(P.CREDITOR_ACCOUNT_VIEW)
  settlements(@Query() q: ListSettlementsQuery) {
    return this.queries.listSettlements({ ...q, statuses: q.status, sort: parseSort(q.sort, SETTLEMENT_SORTABLE) });
  }

  @Get('settlements/:id')
  @RequirePermissions(P.CREDITOR_ACCOUNT_VIEW)
  async settlement(@Param('id', IdPipe) id: number) {
    return { data: await this.queries.settlement(String(id)) };
  }

  @Get('settlements/:id/proof')
  @RequirePermissions(P.CREDITOR_ACCOUNT_VIEW)
  async settlementProof(@Param('id', IdPipe) id: number, @Res() res: Response) {
    const s = await this.queries.settlement(String(id));
    res.download(this.storage.absolutePath(s.proofPath));
  }

  @Post('settlements/:id/confirm')
  @HttpCode(200)
  @RequirePermissions(U.CREDITOR_SETTLEMENT_PERMISSION)
  @ApiOperation({ summary: 'Confirmar acerto (quatro olhos): entra na conta-corrente' })
  async confirm(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number) {
    return { message: 'Acerto confirmado', data: await this.confirmSettlement.execute(me, String(id)) };
  }

  @Post('settlements/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(U.CREDITOR_SETTLEMENT_PERMISSION)
  async cancel(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() d: ReasonDto) {
    await this.cancelSettlement.execute(me, String(id), d.reason);
    return { message: 'Acerto anulado' };
  }

  @Get(':organizationId')
  @ApiOperation({ summary: 'Conta-corrente de um credor: saldo, componentes e extracto' })
  @RequirePermissions(P.CREDITOR_ACCOUNT_VIEW)
  async account(@Param('organizationId', IdPipe) organizationId: number, @Query() q: StatementQuery) {
    return { data: await this.queries.account(organizationId, q.page, q.perPage, q.from, q.to) };
  }

  @Patch(':organizationId/commission-rate')
  @RequirePermissions(U.CREDITOR_COMMISSION_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Definir a % de comissão do credor (aplica-se a pagamentos confirmados a partir de agora)' })
  async commission(@Param('organizationId', IdPipe) organizationId: number, @Body() d: CommissionRateDto) {
    await this.setRate.execute(organizationId, d.rate);
    return { message: 'Taxa de comissão actualizada' };
  }

  @Post(':organizationId/settlements')
  @Idempotent()
  @RequirePermissions(U.CREDITOR_SETTLEMENT_PERMISSION)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('proof'))
  @ApiOperation({ summary: 'Registar repasse/recebimento com comprovativo (fica pendente de confirmação)' })
  async register(
    @CurrentUser() me: AuthenticatedUser,
    @Param('organizationId', IdPipe) organizationId: number,
    @Body() d: RegisterSettlementDto,
    @UploadedFile() proof?: Express.Multer.File,
  ) {
    if (!proof) throw new ValidationError('O comprovativo é obrigatório (campo "proof")');
    assertFileType(proof, { ...PDF_TYPES, ...IMAGE_TYPES });
    const r = await this.registerSettlement.execute(
      { organizationId, direction: d.direction, amount: d.amount, settledOn: d.settledOn, paymentMethodId: d.paymentMethodId, reference: d.reference, notes: d.notes, proof: toBinary(proof) },
      me.id,
    );
    return { message: 'Acerto registado; aguarda confirmação', data: r };
  }
}
