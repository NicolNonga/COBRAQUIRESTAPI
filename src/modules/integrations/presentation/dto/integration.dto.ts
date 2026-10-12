import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '@/shared/presentation/pagination.dto';
import { ERP_PROVIDERS, ErpProvider } from '../../domain/canonical';
import { REVIEW_KINDS, ReviewKind } from '../../domain/reconciliation';
import { ReviewStatus, RunMode } from '../../domain/integration.repository';

export class CompanyCreditorDto {
  @ApiProperty({ example: '1000', description: 'Empresa no ERP (company code do SAP)' })
  @IsString()
  @Length(1, 40)
  companyCode: string;

  @ApiProperty({ example: 3, description: 'Credor no Cobraqui' })
  @IsInt()
  @Min(1)
  organizationId: number;
}

export class UpdateIntegrationDto {
  @ApiProperty({ description: 'Versão lida (bloqueio optimista)' })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ enum: ERP_PROVIDERS })
  @IsOptional()
  @IsIn(ERP_PROVIDERS)
  provider?: ErpProvider;

  @ApiPropertyOptional({ description: 'Configuração do conector (URL, filtros). Nunca palavras-passe: essas vão em /integration/credentials.' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Fechar processos automaticamente quando tudo fica liquidado no ERP (desligado: vão para revisão)' })
  @IsOptional()
  @IsBoolean()
  autoClose?: boolean;

  @ApiPropertyOptional({ description: 'Criar devedores a partir dos clientes do ERP' })
  @IsOptional()
  @IsBoolean()
  importDebtors?: boolean;

  @ApiPropertyOptional({ minimum: 5, maximum: 1440, description: 'Minutos entre sincronizações' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  intervalMinutes?: number;

  @ApiPropertyOptional({ type: [CompanyCreditorDto], description: 'Empresa do ERP → credor (substitui a lista inteira)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CompanyCreditorDto)
  companies?: CompanyCreditorDto[];
}

export class SetCredentialsDto {
  @ApiProperty({ example: { username: 'COBRAQUI_RFC', password: '••••' }, description: 'Campos do conector; objecto vazio apaga as credenciais' })
  @IsObject()
  credentials: Record<string, string>;
}

export class StartRunDto {
  @ApiProperty({ enum: ['DELTA', 'FULL', 'DRY_RUN'], description: 'DRY_RUN = simulação: mostra o que faria sem gravar nada' })
  @IsIn(['DELTA', 'FULL', 'DRY_RUN'])
  mode: RunMode;
}

export class ListReviewsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'RESOLVED', 'IGNORED'] })
  @IsOptional()
  @IsIn(['OPEN', 'RESOLVED', 'IGNORED'])
  status?: ReviewStatus;

  @ApiPropertyOptional({ enum: REVIEW_KINDS })
  @IsOptional()
  @IsIn(REVIEW_KINDS)
  kind?: ReviewKind;
}

export class ResolveReviewDto {
  @ApiProperty({ enum: ['RESOLVE', 'IGNORE', 'CLOSE_PROCESS'] })
  @IsIn(['RESOLVE', 'IGNORE', 'CLOSE_PROCESS'])
  action: 'RESOLVE' | 'IGNORE' | 'CLOSE_PROCESS';

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
