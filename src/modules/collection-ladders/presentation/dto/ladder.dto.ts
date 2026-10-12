import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { DEBTOR_CHANNELS, DebtorChannel, LADDER_ACTIONS, LADDER_LIMITS, LADDER_PRIORITIES, LADDER_RECIPIENTS, LadderAction, LadderPriority, LadderRecipients, TEMPLATE_VARIABLES } from '../../domain/ladder';

export class LadderStepDto {
  @ApiProperty({ example: 1, description: 'Dia desde a entrada do processo em cobrança (0 = dia de entrada)' })
  @IsInt() @Min(0) @Max(LADDER_LIMITS.maxDay)
  dayOffset: number;

  @ApiProperty({ enum: LADDER_ACTIONS, example: 'CONTACT_REMINDER' })
  @IsIn(LADDER_ACTIONS)
  actionType: LadderAction;

  @ApiProperty({ enum: LADDER_RECIPIENTS, example: 'AGENT', description: 'AGENT = comercial responsável, MANAGER = gestor do comercial, BOTH = ambos' })
  @IsIn(LADDER_RECIPIENTS)
  recipients: LadderRecipients;

  @ApiPropertyOptional({ enum: LADDER_PRIORITIES, default: 'medium' })
  @IsOptional() @IsIn(LADDER_PRIORITIES)
  priority: LadderPriority = 'medium';

  @ApiProperty({ example: 'Primeiro contacto' })
  @IsString() @IsNotEmpty() @MaxLength(150)
  title: string;

  @ApiProperty({
    example: 'Ligar a {{debtorName}} (processo {{processId}}, dia {{day}}). Em dívida: {{totalAmount}}',
    description: `Variáveis disponíveis: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(', ')}`,
  })
  @IsString() @IsNotEmpty() @MaxLength(2000)
  messageTemplate: string;

  @ApiPropertyOptional({
    example: 2,
    nullable: true,
    description: 'Prazo (dias) para o agente cumprir o passo registando um contacto no processo. Vazio = passo só informativo. Fora do prazo → em atraso e o gestor é avisado.',
  })
  @IsOptional() @IsInt() @Min(0) @Max(LADDER_LIMITS.maxFulfillmentDays)
  fulfillmentDays?: number | null;

  @ApiPropertyOptional({ enum: DEBTOR_CHANNELS, default: 'NONE', description: 'Mensagem ao devedor neste passo: NONE, EMAIL, SMS ou EMAIL_SMS' })
  @IsOptional() @IsIn(DEBTOR_CHANNELS)
  debtorChannel?: DebtorChannel;

  @ApiPropertyOptional({ example: 'Lembrete: factura em atraso', nullable: true })
  @IsOptional() @IsString() @MaxLength(150)
  debtorSubject?: string | null;

  @ApiPropertyOptional({ example: 'Caro(a) {{debtorName}}, tem {{totalAmount}} em atraso.', nullable: true })
  @IsOptional() @IsString() @MaxLength(2000)
  debtorMessageTemplate?: string | null;
}

export class CreateLadderDto {
  @ApiProperty({ example: 'Régua padrão PME' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiProperty({ type: [LadderStepDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(LADDER_LIMITS.maxSteps) @ValidateNested({ each: true }) @Type(() => LadderStepDto)
  steps: LadderStepDto[];
}

export class UpdateLadderDto extends CreateLadderDto {
  @ApiProperty({ example: 1, description: 'Versão que está a editar (lock optimista). 409 se alguém alterou entretanto.' })
  @IsInt() @Min(1)
  expectedVersion: number;
}

export class ListLaddersQuery {
  @ApiPropertyOptional({ description: 'Gestor: ver as réguas de um comercial da sua equipa' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) ownerId?: number;
  @ApiPropertyOptional({ type: Boolean, default: false }) @IsOptional() @Type(() => String) includeArchived?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage: number = 20;
}

export class PolicyRuleDto {
  @ApiProperty({ enum: LADDER_ACTIONS }) @IsIn(LADDER_ACTIONS) actionType: LadderAction;
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) @Max(LADDER_LIMITS.maxDay) minDay: number;
  @ApiProperty({ example: 30 }) @IsInt() @Min(0) @Max(LADDER_LIMITS.maxDay) maxDay: number;
  @ApiPropertyOptional({ example: 3, nullable: true, description: 'Prazo máximo de cumprimento; vazio = livre' })
  @IsOptional() @IsInt() @Min(0) @Max(LADDER_LIMITS.maxFulfillmentDays) maxFulfillmentDays?: number | null;
  @ApiProperty({ example: false, description: 'A régua tem de ter pelo menos um passo deste tipo na janela' }) @IsBoolean() required: boolean;
}

export class UpdatePolicyDto {
  @ApiProperty({ example: 1, description: 'Versão que está a editar (lock optimista)' }) @IsInt() @Min(1) expectedVersion: number;
  @ApiProperty({ example: 'Régua master' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiProperty({ example: 3, description: 'Dias de tolerância após o vencimento antes de a factura entrar em cobrança' }) @IsInt() @Min(0) @Max(365) graceDays: number;
  @ApiProperty({ example: 90, description: 'Duração máxima da cobrança de um processo' }) @IsInt() @Min(1) @Max(LADDER_LIMITS.maxDay) maxCollectionDays: number;
  @ApiProperty({ example: 10 }) @IsInt() @Min(1) @Max(LADDER_LIMITS.maxSteps) maxSteps: number;
  @ApiPropertyOptional({ example: 15, nullable: true, description: 'Contactos por processo; vazio = sem limite' }) @IsOptional() @IsInt() @Min(1) @Max(1000) maxContactsPerProcess?: number | null;
  @ApiProperty({ example: ['EMAIL'], description: 'Canais permitidos ao devedor' }) @IsArray() @IsIn(['EMAIL', 'SMS'], { each: true }) allowedDebtorChannels: Array<'EMAIL' | 'SMS'>;
  @ApiProperty({ example: 3 }) @IsInt() @Min(0) @Max(365) minDaysBetweenDebtorMessages: number;
  @ApiProperty({ type: [PolicyRuleDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => PolicyRuleDto) rules: PolicyRuleDto[];
}
