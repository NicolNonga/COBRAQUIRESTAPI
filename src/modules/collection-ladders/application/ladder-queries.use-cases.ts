import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { Clock } from '@/shared/application/clock.port';
import { ForbiddenError, NotFoundError } from '@/shared/domain/errors';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { LadderEngine, LadderRepository } from '../domain/ladder.repository';
import { templateVars, renderTemplate } from '../domain/ladder';
import { luandaToday } from './luanda-date';

@Injectable()
export class LadderQueriesUseCase {
  private readonly catchUp: number;

  constructor(
    private readonly ladders: LadderRepository,
    private readonly engine: LadderEngine,
    private readonly users: UserRepository,
    private readonly clock: Clock,
    cfg: ConfigService,
  ) {
    this.catchUp = Number(cfg.get('LADDER_CATCHUP_DAYS', 2));
  }

  /** As minhas réguas; um gestor pode consultar as dos seus agentes (só leitura). */
  async list(me: AuthenticatedUser, ownerId: number | undefined, includeArchived: boolean, page: number, perPage: number) {
    const owner = ownerId ?? me.id;
    if (owner !== me.id) await this.assertCanRead(me, owner);
    return this.ladders.listByOwner(owner, includeArchived, page, perPage);
  }

  async get(me: AuthenticatedUser, id: number) {
    const l = await this.ladders.findById(id);
    if (!l) throw new NotFoundError('Régua não encontrada');
    if (l.ownerUserId !== me.id) await this.assertCanRead(me, l.ownerUserId);
    return { ...l, executions: await this.ladders.executionsCount(id) };
  }

  /** O que esta régua faria HOJE nos processos do dono (nada é gravado nem enviado). */
  async preview(me: AuthenticatedUser, id: number) {
    const l = await this.get(me, id);
    const rows = await this.engine.preview(id, l.ownerUserId, luandaToday(this.clock.now()), this.catchUp);
    return rows.map((r) => ({
      ...r,
      message: renderTemplate(r.messageTemplate, templateVars(r)),
      debtorMessage: r.debtorMessageTemplate && r.debtorChannel !== 'NONE' ? renderTemplate(r.debtorMessageTemplate, templateVars(r)) : null,
      debtorSubject: r.debtorSubject ? renderTemplate(r.debtorSubject, templateVars(r)) : null,
    }));
  }

  /** Porque é que a pré-visualização está vazia: processos do dono, dia actual e próxima etapa. */
  async coverage(me: AuthenticatedUser, id: number) {
    const l = await this.get(me, id);
    const processes = await this.engine.coverage(id, l.ownerUserId, luandaToday(this.clock.now()));
    return { ownerUserId: l.ownerUserId, catchUpDays: this.catchUp, processes };
  }

  private async assertCanRead(me: AuthenticatedUser, ownerId: number): Promise<void> {
    if (!me.isManager) throw new ForbiddenError('Só pode consultar as suas réguas');
    const managerId = await this.users.managerOf(ownerId);
    if (managerId !== me.id) throw new ForbiddenError('Este comercial não pertence à sua equipa');
  }
}
