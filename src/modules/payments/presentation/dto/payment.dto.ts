import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ListQueryDto, toBool } from '@/shared/presentation/criteria-query.dto';
import { PAYMENT_RECEIVERS, PAYMENT_STATUSES, PaymentReceiver, PaymentStatus } from '../../domain/payment';

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const RATE = /^\d{1,12}(\.\d{1,6})?$/;
const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

/** multipart/form-data: os números chegam como texto → @Type(() => Number) */
export class RegisterPaymentDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) negotiationId: number;

  @ApiPropertyOptional({ description: 'Prestação a que o pagamento se destina. Opcional: sem prestação, cobre as prestações em aberto por vencimento.' })
  @IsOptional() @Transform(emptyToUndefined) @Type(() => Number) @IsInt() @Min(1)
  installmentId?: number;

  @ApiProperty({ enum: PAYMENT_RECEIVERS, description: 'CREDITOR = pago directamente ao credor (A); AGENCY = pago à empresa de cobrança (B)' })
  @IsIn(PAYMENT_RECEIVERS)
  receiver: PaymentReceiver;

  @ApiProperty({ example: '50000.00', description: 'Valor na moeda do pagamento. Acima do que falta é aceite: o excedente abate as prestações seguintes e o resto fica como crédito.' })
  @Transform(toStr) @Matches(MONEY, { message: 'amount deve ser decimal com até 2 casas' })
  amount: string;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) currencyId: number;

  @ApiPropertyOptional({ example: '912.500000', description: 'Obrigatória se a moeda não for a moeda base' })
  @IsOptional() @Transform(emptyToUndefined) @Transform(toStr) @Matches(RATE)
  exchangeRate?: string;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) paymentMethodId: number;

  @ApiProperty({ format: 'date', example: '2026-10-05', description: 'Data que consta no comprovativo' })
  @IsDateString({ strict: true })
  paidOn: string;

  @ApiPropertyOptional({ description: 'Nº da transferência/talão (obrigatório se o meio o exigir)' })
  @IsOptional() @IsString() @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @ApiProperty({ type: 'string', format: 'binary', description: 'Comprovativo (PDF, PNG ou JPG) — obrigatório' })
  proof: unknown;
}

export class ReasonDto {
  @ApiProperty({ minLength: 5, example: 'Comprovativo ilegível / valor não corresponde' })
  @IsString() @MinLength(5) @MaxLength(1000)
  reason: string;
}

const csvUpper = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim().toUpperCase());

export class ListPaymentsQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES, isArray: true, description: 'Estado(s), separados por vírgula', example: 'PENDING,CONFIRMED' })
  @IsOptional() @Transform(csvUpper) @IsIn(PAYMENT_STATUSES, { each: true })
  status?: PaymentStatus[];

  @ApiPropertyOptional({ enum: PAYMENT_RECEIVERS }) @IsOptional() @IsIn(PAYMENT_RECEIVERS) receiver?: PaymentReceiver;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) negotiationId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) installmentId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) debtorId?: number;
  @ApiPropertyOptional({ description: 'Credor' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) registeredById?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) paymentMethodId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) currencyId?: number;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) paidFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) paidTo?: string;
  @ApiPropertyOptional({ example: '1000.00', description: 'Valor (moeda base) mínimo' }) @IsOptional() @Matches(MONEY) minAmount?: string;
  @ApiPropertyOptional({ example: '50000.00', description: 'Valor (moeda base) máximo' }) @IsOptional() @Matches(MONEY) maxAmount?: string;
}

export class PageQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) perPage: number = 20;
}

export class ActiveFilterQuery {
  @ApiPropertyOptional({ type: Boolean, description: 'true (por defeito) = só activos' }) @IsOptional() @toBool() @IsBoolean() onlyActive?: boolean;
}

export class CreatePaymentMethodDto {
  @ApiProperty({ example: 'Transferência bancária' }) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ description: 'Exige nº de referência do comprovativo' }) @IsBoolean() requiresReference: boolean;
}

export class UpdatePaymentMethodDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresReference?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateCurrencyDto {
  @ApiProperty({ example: 'USD', description: 'Código ISO-4217' }) @IsString() @Length(3, 3) @Matches(/^[A-Za-z]{3}$/) code: string;
  @ApiProperty({ example: 'Dólar americano' }) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @ApiProperty({ example: '$' }) @IsString() @IsNotEmpty() @MaxLength(10) symbol: string;
}

export class UpdateCurrencyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(10) symbol?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
