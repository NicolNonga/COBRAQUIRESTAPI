import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { DashboardUseCase } from '../application/dashboard.use-case';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';

class DashboardQuery {
  @ApiPropertyOptional({ format: 'date', description: 'Início do período (por defeito: dia 1 do mês corrente)' })
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date', description: 'Fim do período (por defeito: hoje)' })
  @IsOptional() @IsDateString({ strict: true }) to?: string;
  @ApiPropertyOptional({ description: 'Filtrar por agente (dentro do que pode ver)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) agentId?: number;
  @ApiPropertyOptional({ description: 'Filtrar por credor' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) organizationId?: number;
}

const DEFINITIONS = `**inCollection**: saldo em cobrança agora (processos abertos; com acordo em vigor conta o que falta do acordo).
**placed**: facturas dos processos que entraram em cobrança no período. **recovered**: pagamentos confirmados com data no período (estornos excluídos).
**successRate** = recovered ÷ placed × 100 (null se nada entrou no período). Agente vê os seus; gestor a equipa; \`dashboard_view_all_permission\` vê tudo.`;

@ApiTags('Painel de gestão')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardUseCase) {}

  @Get('summary')
  @ApiOperation({ summary: 'Totais + série mensal (posto em cobrança vs recuperado)', description: DEFINITIONS })
  @RequirePermissions(P.DASHBOARD_VIEW)
  async summary(@CurrentUser() me: AuthenticatedUser, @Query() q: DashboardQuery) {
    return { data: await this.dashboard.summary(me, q) };
  }

  @Get('by-agent')
  @ApiOperation({ summary: 'Em cobrança, recuperado e taxa de sucesso por agente', description: DEFINITIONS })
  @RequirePermissions(P.DASHBOARD_VIEW)
  byAgent(@CurrentUser() me: AuthenticatedUser, @Query() q: DashboardQuery) {
    return this.dashboard.byAgent(me, q);
  }

  @Get('by-creditor')
  @ApiOperation({ summary: 'Em cobrança, recuperado e taxa de sucesso por credor', description: DEFINITIONS })
  @RequirePermissions(P.DASHBOARD_VIEW)
  byCreditor(@CurrentUser() me: AuthenticatedUser, @Query() q: DashboardQuery) {
    return this.dashboard.byCreditor(me, q);
  }
}
