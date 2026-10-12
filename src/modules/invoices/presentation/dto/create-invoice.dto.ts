import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateInvoiceDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) debtor_id: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) currency_id: number;
  @ApiProperty({ description: 'Número/referência da factura (único)' }) @IsString() @IsNotEmpty() @MaxLength(100) refencence_number: string;
  @ApiProperty({ example: '150000.00', description: 'Valor decimal como string (2 casas). Evita perda de precisão.' })
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'amount deve ser um valor positivo com até 2 casas decimais' })
  amount: string;
  @ApiProperty({ description: 'Prazo de pagamento em dias' }) @Type(() => Number) @IsInt() @Min(0) @Max(3650) time_limit: number;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString({ strict: true }) issue_date: string;
  @ApiProperty({ type: 'string', format: 'binary', required: false }) file?: unknown;
}

/** Edição (JSON): os mesmos campos da criação, sem o PDF (anexa-se em POST /invoices/:id/document). */
export class UpdateInvoiceDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) debtor_id: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) currency_id: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) refencence_number: string;
  @ApiProperty({ example: '150000.00' })
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'amount deve ser um valor positivo com até 2 casas decimais' })
  amount: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(3650) time_limit: number;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString({ strict: true }) issue_date: string;
}
