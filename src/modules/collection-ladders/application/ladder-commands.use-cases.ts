import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { auditDiff, prefixed } from '@/shared/application/audit-diff';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError } from '@/shared/domain/errors';
import { assertLadderCompliant, checkLadder, CollectionPolicy } from '@/modules/collection-policies/domain/policy';
import { PolicyRepository } from '@/modules/collection-policies/domain/policy.repository';
import { LadderPolicy, LadderStepInput } from '../domain/ladder';
import { LadderRepository } from '../domain/ladder.repository';
import { assertOwner } from './ladder-access';

/** A régua master é obrigatória: sem ela não há critério para aceitar réguas. */
export const requirePolicy = async (policies: PolicyRepository): Promise<CollectionPolicy> => {
  const policy = await policies.get();
  if (!policy) throw new BusinessRuleError('A régua master ainda não foi definida. Peça ao administrador para a configurar antes de criar réguas.');
  return policy;
};

export interface LadderInput {
  name: string;
  description?: string | null;
  steps: LadderStepInput[];
}

@Injectable()
export class CreateLadderUseCase {
  constructor(private readonly ladders: LadderRepository, private readonly policies: PolicyRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  /** A régua nasce inactiva: o comercial revê (preview) e depois activa. */
  execute(me: AuthenticatedUser, input: LadderInput) {
    const steps = LadderPolicy.validateSteps(input.steps);
    return this.uow.run(async () => {
      const policy = await requirePolicy(this.policies);
      assertLadderCompliant(policy, steps);
      const l = await this.ladders.create(me.id, { name: input.name, description: input.description ?? null, policyVersion: policy.version }, steps);
      await this.audit.record({ action: 'LADDER_CREATED', entity: 'collection_ladder', entityId: l.id, payload: { name: l.name, steps } });
      return { id: l.id };
    });
  }
}

@Injectable()
export class UpdateLadderUseCase {
  constructor(private readonly ladders: LadderRepository, private readonly policies: PolicyRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  /**
   * Edição com lock optimista (`expectedVersion`) + lock de linha: duas janelas abertas a editar
   * a mesma régua → a segunda recebe 409 em vez de sobrescrever silenciosamente.
   * Etapas no mesmo dia mantêm a identidade → não voltam a disparar em processos onde já correram.
   */
  execute(me: AuthenticatedUser, id: number, expectedVersion: number, input: LadderInput) {
    const steps = LadderPolicy.validateSteps(input.steps);
    return this.uow.run(async () => {
      const ladder = assertOwner(await this.ladders.findForUpdate(id), me);
      const policy = await requirePolicy(this.policies);
      assertLadderCompliant(policy, steps);
      if (ladder.version !== expectedVersion) {
        throw new ConflictError(`A régua foi alterada entretanto (versão actual ${ladder.version}). Recarregue e tente de novo.`);
      }
      const summary = (l: { name: string; description: string | null; steps?: LadderStepInput[] } | null) => ({
        name: l?.name ?? null,
        description: l?.description ?? null,
        steps: (l?.steps ?? []).slice().sort((a, b) => a.dayOffset - b.dayOffset).map((s) => `Dia ${s.dayOffset}: ${s.title}`),
      });
      const before = summary(await this.ladders.findById(id));
      await this.ladders.replaceSteps(id, { name: input.name, description: input.description ?? null, policyVersion: policy.version }, steps);
      const after = summary({ name: input.name, description: input.description ?? null, steps });
      await this.audit.record({ action: 'LADDER_UPDATED', entity: 'collection_ladder', entityId: id, payload: { fromVersion: ladder.version, ...auditDiff(before, after) } });
      return { version: ladder.version + 1 };
    });
  }
}

@Injectable()
export class SetLadderActiveUseCase {
  constructor(private readonly ladders: LadderRepository, private readonly policies: PolicyRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  /** Activar uma régua desactiva a anterior do mesmo comercial (1 activa por comercial, garantido por índice). */
  execute(me: AuthenticatedUser, id: number, active: boolean) {
    return this.uow.run(async () => {
      assertOwner(await this.ladders.findForUpdate(id), me);
      if (active) {
        // só se activa uma régua que cumpre a master VIGENTE (a master pode ter mudado desde a última edição)
        const policy = await requirePolicy(this.policies);
        const current = await this.ladders.findById(id);
        const violations = checkLadder(policy, current?.steps ?? []);
        if (violations.length) {
          await this.ladders.setCompliance(id, false, violations, policy.version);
          throw new BusinessRuleError(`Não pode activar: a régua não cumpre a régua master (${violations[0].message}). Corrija-a e tente de novo.`, { violations });
        }
        await this.ladders.setCompliance(id, true, null, policy.version);
        await this.ladders.deactivateOthers(me.id, id);
      }
      await this.ladders.setActive(id, active);
      await this.audit.record({ action: active ? 'LADDER_ACTIVATED' : 'LADDER_DEACTIVATED', entity: 'collection_ladder', entityId: id, payload: { before: { isActive: !active }, after: { isActive: active } } });
    });
  }
}

@Injectable()
export class ArchiveLadderUseCase {
  constructor(private readonly ladders: LadderRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  /** Nunca se apaga uma régua (o histórico de execuções aponta para ela): arquiva-se. */
  execute(me: AuthenticatedUser, id: number) {
    return this.uow.run(async () => {
      const l = assertOwner(await this.ladders.findForUpdate(id), me);
      if (l.isActive) throw new ConflictError('Desactive a régua antes de a arquivar');
      await this.ladders.archive(id);
      await this.audit.record({ action: 'LADDER_ARCHIVED', entity: 'collection_ladder', entityId: id });
    });
  }
}
