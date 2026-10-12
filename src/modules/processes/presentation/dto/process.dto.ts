import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { CONTACT_STATUSES, ContactStatus } from '../../infrastructure/process.orm-entities';

export class AssignProcessDto {
  @ApiProperty() @IsInt() @Min(1) userId: number;
  @ApiProperty() @IsInt() @Min(1) processeId: number;
}

export class RemoveInvoicesDto {
  @ApiProperty({ type: [Number] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsInt({ each: true }) @Min(1, { each: true }) invoiceIds: number[];
  @ApiProperty() @IsInt() @Min(1) processId: number;
  @ApiPropertyOptional({ description: 'Motivo da disputa (recomendado)', example: 'Devedor contesta a quantidade facturada' })
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

class ProcessRefDto {
  @ApiProperty() @IsInt() @Min(1) processId: number;
}

export class TransferProcessesDto {
  @ApiProperty({ type: [ProcessRefDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProcessRefDto)
  processes: ProcessRefDto[];

  @ApiProperty() @IsInt() @Min(1) agenteOrigemId: number;
  @ApiProperty() @IsInt() @Min(1) agenteDestinoId: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) motivoTransferencia: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) observacoes?: string;
  @ApiProperty({ description: 'true = definitiva; false = temporária (exige dateToRetornProcess)' }) @IsBoolean() transferenciaDefinitiva: boolean;
  @ApiPropertyOptional({ example: '2026-11-01T08:00:00Z' }) @IsOptional() @IsDateString() dateToRetornProcess?: string;
}

export class CreateContactDto {
  @ApiProperty() @IsInt() @Min(1) processe_id: number;
  @ApiProperty({ description: 'Canal: chamada, email, SMS, visita… (GET /contact_type)' }) @IsInt() @Min(1) contact_type_id: number;
  @ApiPropertyOptional({ enum: CONTACT_STATUSES, default: 'attempted', description: 'Resultado do contacto' })
  @IsOptional() @IsIn(CONTACT_STATUSES) status?: ContactStatus;
  @ApiPropertyOptional({ example: '2026-10-05T14:30:00Z', description: 'Quando aconteceu (por omissão: agora; até 30 dias atrás)' })
  @IsOptional() @IsDateString() contacted_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @ApiPropertyOptional({ description: 'Duração em segundos' }) @IsOptional() @IsInt() @Min(0) @Max(86_400) duration?: number;
  @ApiPropertyOptional({ example: '2026-10-05' }) @IsOptional() @IsDateString({ strict: true }) contact_date?: string;
}
