import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { Idempotent } from '@/infrastructure/idempotency/idempotent.decorator';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { ApiSort, ListQueryDto, parseSort } from '@/shared/presentation/criteria-query.dto';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import * as U from '../application/invoice-dispute.use-cases';
import { DISPUTE_OUTCOMES, DISPUTE_SORTABLE, DISPUTE_STATUSES, DisputeOutcome, DisputeStatus } from '../domain/invoice-dispute';
import { P } from '@/modules/access-control/domain/permission-catalog';

const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value);

class OpenDisputeDto {
  @ApiProperty() @IsInt() @Min(1) invoiceId: number;
  @ApiProperty({ minLength: 5, example: 'Devedor alega que o serviço não foi prestado' }) @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

class ResolveDisputeDto {
  @ApiProperty({ enum: DISPUTE_OUTCOMES, description: 'UPHELD = procedente p/ credor (volta à cobrança); CANCELLED = factura anulada; ADJUSTED = valor corrigido (volta à cobrança)' })
  @IsIn(DISPUTE_OUTCOMES)
  outcome: DisputeOutcome;
  @ApiProperty({ minLength: 5, example: 'Credor apresentou guia de entrega assinada' }) @IsString() @MinLength(5) @MaxLength(2000) notes: string;
  @ApiPropertyOptional({ example: '80000.00', description: 'Obrigatório só em ADJUSTED' })
  @IsOptional() @Transform(toStr) @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  adjustedAmount?: string;
}

class ListDisputesQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: DISPUTE_STATUSES, isArray: true, example: 'OPEN' })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim().toUpperCase()))
  @IsIn(DISPUTE_STATUSES, { each: true })
  status?: DisputeStatus[];
  @ApiPropertyOptional({ enum: DISPUTE_OUTCOMES }) @IsOptional() @IsIn(DISPUTE_OUTCOMES) outcome?: DisputeOutcome;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) invoiceId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) debtorId?: number;
  @ApiPropertyOptional({ description: 'Credor' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) openedFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) openedTo?: string;
}

@ApiTags('Facturas em disputa')
@ApiBearerAuth()
@Controller('invoice-disputes')
export class InvoiceDisputesController {
  constructor(private readonly open: U.OpenDisputeUseCase, private readonly resolve: U.ResolveDisputeUseCase, private readonly queries: U.DisputeQueriesUseCase) {}

  @Post()
  @Idempotent({ required: false })
  @ApiOperation({ summary: 'Pôr factura em disputa (sai do processo; não pode ter acordo em vigor)' })
  @RequirePermissions(P.DISPUTE_OPEN)
  async openOne(@CurrentUser() me: AuthenticatedUser, @Body() d: OpenDisputeDto) {
    return { message: 'Factura em disputa', data: await this.open.execute(me, d.invoiceId, d.reason) };
  }

  @Get()
  @ApiOperation({ summary: 'Disputas (search: referência da factura / devedor). Por defeito as mais antigas primeiro.' })
  @ApiSort(DISPUTE_SORTABLE, 'openedAt:asc')
  @RequirePermissions(P.DISPUTE_VIEW)
  index(@Query() q: ListDisputesQuery) {
    return this.queries.list({ ...q, statuses: q.status, sort: parseSort(q.sort, DISPUTE_SORTABLE) });
  }

  @Get(':id')
  @RequirePermissions(P.DISPUTE_VIEW)
  async show(@Param('id', IdPipe) id: number) {
    return { data: await this.queries.byId(String(id)) };
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(U.INVOICE_DISPUTE_RESOLVE_PERMISSION)
  @ApiOperation({ summary: 'Resolver: procedente (volta à cobrança), anulada, ou valor corrigido' })
  async resolveOne(@CurrentUser() me: AuthenticatedUser, @Param('id', IdPipe) id: number, @Body() d: ResolveDisputeDto) {
    return { message: 'Disputa resolvida', data: await this.resolve.execute(me, String(id), d) };
  }
}
