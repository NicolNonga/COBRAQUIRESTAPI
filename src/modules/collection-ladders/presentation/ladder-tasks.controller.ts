import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { LadderTrackingQueriesUseCase } from '../application/ladder-tracking.use-cases';
import { LADDER_TASK_STATUSES, LadderTaskStatus } from '../domain/ladder';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';

class TasksQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage: number = 20;
  @ApiPropertyOptional({ enum: LADDER_TASK_STATUSES, isArray: true, example: 'PENDING,OVERDUE' })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim().toUpperCase()))
  @IsIn(LADDER_TASK_STATUSES, { each: true })
  status?: LadderTaskStatus[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) agentId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) ladderId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) processId?: number;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) dueFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) dueTo?: string;
}

class ComplianceQuery {
  @ApiPropertyOptional({ format: 'date', description: 'Por defeito: dia 1 do mês corrente' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date', description: 'Por defeito: hoje' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) agentId?: number;
}

@ApiTags('Régua de cobrança — cumprimento')
@ApiBearerAuth()
@Controller('collection-ladder-tasks')
export class LadderTasksController {
  constructor(private readonly queries: LadderTrackingQueriesUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Passos da régua com prazo: em atraso primeiro, depois pendentes',
    description: 'Um passo fica cumprido quando é registado um contacto no processo. Agente vê os seus; gestor a equipa; dashboard_view_all_permission vê tudo.',
  })
  @RequirePermissions(P.LADDER_VIEW)
  tasks(@CurrentUser() me: AuthenticatedUser, @Query() q: TasksQuery) {
    return this.queries.tasks(me, { ...q, statuses: q.status });
  }

  @Get('compliance')
  @ApiOperation({ summary: 'Cumprimento por agente no período: no prazo, tarde, em atraso, pendentes; taxa = no prazo ÷ decididos' })
  @RequirePermissions(P.LADDER_VIEW)
  async compliance(@CurrentUser() me: AuthenticatedUser, @Query() q: ComplianceQuery) {
    return this.queries.compliance(me, q);
  }
}
