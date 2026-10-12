import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBool } from '@/shared/presentation/criteria-query.dto';
import { NEGOTIATION_STATUSES } from '../../infrastructure/negotiation.orm-entities';

/** Dinheiro trafega como string decimal → sem perda de precisão no JSON. Números também são aceites. */
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value);

class ProcessRef {
  @ApiProperty() @IsInt() @Min(1) id: number;
}

export class InstallmentDto {
  @ApiProperty() @IsInt() @Min(1) @Max(360) installmentNumber: number;
  @ApiProperty({ example: '50000.00' }) @Transform(toStr) @Matches(MONEY) installmentAmount: string;
  @ApiProperty({ example: '33.33' }) @Transform(toStr) @Matches(PERCENT) installmentPercentage: string;
  @ApiProperty({ example: '2026-11-05' }) @IsDateString({ strict: true }) dueDate: string;
  @ApiProperty({ example: '2' }) @Transform(toStr) @Matches(PERCENT) penaltyPercentage: string;
}

export class CreateNegotiationDto {
  @ApiProperty({ example: '150000.00' }) @Transform(toStr) @Matches(MONEY) debtAmount: string;
  @ApiProperty({ example: '15000.00' }) @Transform(toStr) @Matches(MONEY) discountAmount: string;
  @ApiProperty({ example: '10' }) @Transform(toStr) @Matches(PERCENT) discountRate: string;
  @ApiProperty({ example: '135000.00' }) @Transform(toStr) @Matches(MONEY) totalAmount: string;
  @ApiProperty({ example: '135000.00' }) @Transform(toStr) @Matches(MONEY) finalAmount: string;
  @ApiProperty({ example: '2026-10-05' }) @IsDateString({ strict: true }) effectiveDate: string;
  @ApiProperty({ example: '2026-10-05' }) @IsDateString({ strict: true }) startDate: string;
  @ApiProperty({ example: '2027-01-05' }) @IsDateString({ strict: true }) endDate: string;
  @ApiProperty() @IsBoolean() isInstallmentment: boolean;
  @ApiProperty() @IsBoolean() isParcelaIgual: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(360) totalInstallments?: number;
  @ApiProperty({ type: [ProcessRef] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ProcessRef)
  processes: ProcessRef[];
  @ApiPropertyOptional({ type: [InstallmentDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(360) @ValidateNested({ each: true }) @Type(() => InstallmentDto)
  installmentments?: InstallmentDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CancelNegotiationDto {
  @ApiProperty() @IsString() @MaxLength(500) reason: string;
}

export class ListNegotiationsQuery extends ListQueryDto {
  @ApiPropertyOptional({ example: 'PENDING_APPROVAL', enum: NEGOTIATION_STATUSES, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim().toUpperCase()))
  @IsIn(NEGOTIATION_STATUSES, { each: true })
  status?: string[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) debtorId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) createdById?: number;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @toBool() @IsBoolean() isInstallment?: boolean;
  @ApiPropertyOptional({ example: '1000.00' }) @IsOptional() @Matches(MONEY) minTotal?: string;
  @ApiPropertyOptional({ example: '500000.00' }) @IsOptional() @Matches(MONEY) maxTotal?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-01-01' }) @IsOptional() @IsDateString({ strict: true }) effectiveFrom?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-01-01' }) @IsOptional() @IsDateString({ strict: true }) effectiveTo?: string;
}

export class SimulateValuesDto {
  @ApiProperty({ example: '150000.00' }) @Transform(toStr) @Matches(MONEY) debtAmount: string;
  @ApiProperty({ example: '10' }) @Transform(toStr) @Matches(PERCENT) discountRate: string;
}

export class SimulateInstallmentsDto {
  @ApiProperty({ example: '135000.00' }) @Transform(toStr) @Matches(MONEY) totalAmount: string;
  @ApiProperty({ example: 3 }) @IsInt() @Min(1) @Max(60) count: number;
  @ApiProperty({ example: '2026-10-05' }) @IsDateString({ strict: true }) startDate: string;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @IsInt() @Min(1) @Max(365) intervalDays?: number;
  @ApiPropertyOptional({ example: '2' }) @IsOptional() @Transform(toStr) @Matches(PERCENT) penaltyPercentage?: string;
  @ApiPropertyOptional({ enum: ['equal', 'decreasing'] }) @IsOptional() @IsIn(['equal', 'decreasing']) type?: 'equal' | 'decreasing';
  @ApiPropertyOptional({ example: '50' }) @IsOptional() @Transform(toStr) @Matches(PERCENT) firstPercent?: string;
}

export class SimulateOverdueDto {
  @ApiProperty({ example: '45000.00' }) @Transform(toStr) @Matches(MONEY) amount: string;
  @ApiProperty({ example: '2' }) @Transform(toStr) @Matches(PERCENT) penaltyPercentage: string;
  @ApiProperty({ example: '1' }) @Transform(toStr) @Matches(PERCENT) monthlyInterest: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(0) @Max(600) monthsLate: number;
}

export class ReasonDto {
  @ApiProperty({ example: 'Devedor informou que não consegue pagar' }) @IsString() @MaxLength(1000) reason: string;
}

/** Igual à criação, sem `debtAmount` (calculado no servidor) nem `processes` (herdados do acordo anterior). */
export class RenegotiateDto {
  @ApiProperty({ example: '0.00', description: 'Desconto sobre o NOVO saldo (GET /negotiations/:id/renegotiation-balance)' }) @Transform(toStr) @Matches(MONEY) discountAmount: string;
  @ApiProperty({ example: '0' }) @Transform(toStr) @Matches(PERCENT) discountRate: string;
  @ApiProperty() @Transform(toStr) @Matches(MONEY) totalAmount: string;
  @ApiProperty() @Transform(toStr) @Matches(MONEY) finalAmount: string;
  @ApiProperty({ example: '2026-10-06' }) @IsDateString({ strict: true }) effectiveDate: string;
  @ApiProperty({ example: '2026-10-06' }) @IsDateString({ strict: true }) startDate: string;
  @ApiProperty({ example: '2027-04-06' }) @IsDateString({ strict: true }) endDate: string;
  @ApiProperty() @IsBoolean() isInstallmentment: boolean;
  @ApiProperty() @IsBoolean() isParcelaIgual: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(360) totalInstallments?: number;
  @ApiPropertyOptional({ type: [InstallmentDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(360) @ValidateNested({ each: true }) @Type(() => InstallmentDto)
  installmentments?: InstallmentDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
