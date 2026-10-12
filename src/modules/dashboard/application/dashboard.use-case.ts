import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { Clock } from '@/shared/application/clock.port';
import { resolveTeamScope } from '@/shared/application/team-scope';
import { ValidationError } from '@/shared/domain/errors';
import { DashboardFilter, DashboardQueries } from '../domain/dashboard.port';
import { withRate } from '../domain/success-rate';

export const DASHBOARD_VIEW_ALL_PERMISSION = 'dashboard_view_all_permission';
const MAX_PERIOD_DAYS = 731;

export interface DashboardRequest {
  from?: string;
  to?: string;
  agentId?: number;
  organizationId?: number;
}

const luandaDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda' }).format(d);

/**
 * Painel de gestão. Visibilidade por hierarquia: agente → os seus números; gestor → a sua equipa;
 * `dashboard_view_all_permission` → tudo. Filtros de agente/credor só restringem dentro desse âmbito.
 * Período por defeito: mês corrente.
 */
@Injectable()
export class DashboardUseCase {
  private readonly baseCurrency: string;

  constructor(private readonly q: DashboardQueries, private readonly clock: Clock, @Inject(ConfigService) cfg: ConfigService) {
    this.baseCurrency = String(cfg.get('BASE_CURRENCY_CODE', 'AOA')).toUpperCase();
  }

  private filter(me: AuthenticatedUser, r: DashboardRequest): DashboardFilter {
    const today = luandaDate(this.clock.now());
    const from = r.from ?? `${today.slice(0, 8)}01`;
    const to = r.to ?? today;
    if (from > to) throw new ValidationError('"from" não pode ser depois de "to"');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_PERIOD_DAYS) throw new ValidationError('Período máximo: 2 anos');
    return { from, to, agentId: r.agentId, organizationId: r.organizationId, scope: resolveTeamScope(me, DASHBOARD_VIEW_ALL_PERMISSION), baseCurrencyCode: this.baseCurrency };
  }

  async summary(me: AuthenticatedUser, r: DashboardRequest) {
    const f = this.filter(me, r);
    const [totals, monthly] = await Promise.all([this.q.totals(f), this.q.monthly(f)]);
    return { period: { from: f.from, to: f.to }, scope: f.scope.kind, currency: f.baseCurrencyCode, ...withRate(totals), monthly };
  }

  async byAgent(me: AuthenticatedUser, r: DashboardRequest) {
    const f = this.filter(me, r);
    return { period: { from: f.from, to: f.to }, scope: f.scope.kind, currency: f.baseCurrencyCode, data: (await this.q.byAgent(f)).map(withRate) };
  }

  async byCreditor(me: AuthenticatedUser, r: DashboardRequest) {
    const f = this.filter(me, r);
    return { period: { from: f.from, to: f.to }, scope: f.scope.kind, currency: f.baseCurrencyCode, data: (await this.q.byCreditor(f)).map(withRate) };
  }
}
