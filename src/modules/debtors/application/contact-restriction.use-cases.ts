import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { ContactRestrictions, MessageChannel, RestrictionSource } from '@/shared/application/contact-restrictions.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ConflictError, NotFoundError } from '@/shared/domain/errors';
import { DebtorRepository } from '../domain/debtor.repository';

@Injectable()
export class ListContactRestrictionsUseCase {
  constructor(private readonly debtors: DebtorRepository, private readonly restrictions: ContactRestrictions) {}
  async execute(debtorId: number) {
    if (!(await this.debtors.findById(debtorId))) throw new NotFoundError('Devedor não encontrado');
    return this.restrictions.history(debtorId);
  }
}

/** Registar a oposição do devedor a ser contactado (efeito imediato na régua e no envio). */
@Injectable()
export class AddContactRestrictionUseCase {
  constructor(private readonly debtors: DebtorRepository, private readonly restrictions: ContactRestrictions, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(userId: number, debtorId: number, input: { channel: MessageChannel | 'ALL'; source: RestrictionSource; reason: string }) {
    return this.uow.run(async () => {
      if (!(await this.debtors.findById(debtorId))) throw new NotFoundError('Devedor não encontrado');
      const id = await this.restrictions.add({ debtorId, ...input, reason: input.reason.trim(), userId });
      if (id === null) throw new ConflictError('Já existe uma restrição activa para este canal');
      await this.audit.record({ action: 'CONTACT_RESTRICTION_ADDED', entity: 'debtor', entityId: debtorId, payload: { restrictionId: id, channel: input.channel, source: input.source } });
      return { id };
    });
  }
}

@Injectable()
export class LiftContactRestrictionUseCase {
  constructor(private readonly restrictions: ContactRestrictions, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(userId: number, debtorId: number, restrictionId: number, reason: string) {
    return this.uow.run(async () => {
      if (!(await this.restrictions.lift(restrictionId, debtorId, userId, reason.trim()))) throw new NotFoundError('Restrição activa não encontrada');
      await this.audit.record({ action: 'CONTACT_RESTRICTION_LIFTED', entity: 'debtor', entityId: debtorId, payload: { restrictionId } });
    });
  }
}
