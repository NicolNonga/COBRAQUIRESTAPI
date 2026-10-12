import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { auditDiff, prefixed } from '@/shared/application/audit-diff';
import { FileStorage, UploadedBinary } from '@/shared/application/file-storage.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { NotFoundError } from '@/shared/domain/errors';
import { Criteria, FilterOperator, Sort } from '@/shared/domain/criteria';
import { ContactPersonData, DebtorData, DebtorField, DebtorQueries, DebtorRepository } from '../domain/debtor.repository';

export interface DebtorInput {
  name: string;
  nif: string;
  email: string;
  phone_number: string;
  address: string;
  social_reason?: string;
  organizationId: number;
  typeDebtor_id: number;
  is_company?: boolean;
  contact_person_name: string;
  contact_person_email: string;
  contact_person_contact: string;
  contact_person_position: string;
  logo?: UploadedBinary;
}

const toDebtorData = (i: DebtorInput): DebtorData => ({
  name: i.name.trim(),
  nif: i.nif.trim(),
  email: i.email.trim().toLowerCase(),
  phoneNumber: i.phone_number.trim(),
  address: i.address.trim(),
  socialReason: i.social_reason?.trim() || null,
  organizationId: i.organizationId,
  debtorTypeId: i.typeDebtor_id,
  isCompany: i.is_company ?? true,
});

const toContact = (i: DebtorInput): ContactPersonData => ({
  name: i.contact_person_name.trim(),
  email: i.contact_person_email.trim().toLowerCase(),
  contact: i.contact_person_contact.trim(),
  position: i.contact_person_position.trim(),
});

@Injectable()
export class CreateDebtorUseCase {
  constructor(
    private readonly debtors: DebtorRepository,
    private readonly storage: FileStorage,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(input: DebtorInput): Promise<{ id: number }> {
    const logoPath = input.logo ? await this.storage.save(input.logo, 'logos') : null;
    try {
      // devedor + pessoa de contacto: atómico (o original podia gravar só o devedor)
      return await this.uow.run(async () => {
        const d = await this.debtors.create({ ...toDebtorData(input), logoPath }, toContact(input));
        await this.audit.record({ action: 'DEBTOR_CREATED', entity: 'debtor', entityId: d.id, payload: { nif: d.nif } });
        return { id: d.id };
      });
    } catch (e) {
      if (logoPath) await this.storage.remove(logoPath);
      throw e;
    }
  }
}

@Injectable()
export class UpdateDebtorUseCase {
  constructor(
    private readonly debtors: DebtorRepository,
    private readonly storage: FileStorage,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(id: number, input: DebtorInput): Promise<void> {
    const current = await this.debtors.findById(id);
    if (!current) throw new NotFoundError('Devedor não encontrado');
    const newLogo = input.logo ? await this.storage.save(input.logo, 'logos') : undefined;
    try {
      await this.uow.run(async () => {
        const state = async () => ({
          ...(await this.audit.snapshot('debtors', { id })),
          ...prefixed('contact', await this.audit.snapshot('debtor_contact_persons', { debtor_id: id })),
        });
        const before = await state();
        const data: Partial<DebtorData> = { ...toDebtorData(input), ...(newLogo ? { logoPath: newLogo } : {}) };
        if (!(await this.debtors.update(id, data, toContact(input)))) throw new NotFoundError('Devedor não encontrado');
        await this.audit.record({ action: 'DEBTOR_UPDATED', entity: 'debtor', entityId: id, payload: { ...auditDiff(before, await state()) } });
        // só remove o logo antigo depois do commit (o original apagava antes e podia perder ambos)
        if (newLogo && current.logoPath) this.uow.afterCommit(() => this.storage.remove(current.logoPath!));
      });
    } catch (e) {
      if (newLogo) await this.storage.remove(newLogo);
      throw e;
    }
  }
}

@Injectable()
export class SetDebtorActiveUseCase {
  constructor(private readonly debtors: DebtorRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}
  execute(id: number, active: boolean) {
    return this.uow.run(async () => {
      if (!(await this.debtors.setActive(id, active))) throw new NotFoundError('Devedor não encontrado');
      await this.audit.record({ action: active ? 'DEBTOR_ENABLED' : 'DEBTOR_DISABLED', entity: 'debtor', entityId: id, payload: { before: { isActive: !active }, after: { isActive: active } } });
    });
  }
}

@Injectable()
export class GetDebtorLogoUseCase {
  constructor(private readonly debtors: DebtorRepository, private readonly storage: FileStorage) {}
  async execute(id: number): Promise<string> {
    const d = await this.debtors.findById(id);
    if (!d?.logoPath || !(await this.storage.exists(d.logoPath))) throw new NotFoundError('Logo não encontrado');
    return this.storage.absolutePath(d.logoPath);
  }
}

@Injectable()
export class DebtorQueriesUseCase {
  constructor(private readonly q: DebtorQueries) {}
  list(f: { page: number; perPage: number; search?: string; sort?: Sort<DebtorField>[]; organizationId?: number; debtorTypeId?: number; isActive?: boolean; isCompany?: boolean; createdFrom?: string; createdTo?: string }) {
    return this.q.search(
      Criteria.for<DebtorField>()
        .add('organizationId', f.organizationId)
        .add('debtorTypeId', f.debtorTypeId)
        .add('isActive', f.isActive)
        .add('isCompany', f.isCompany)
        .add('createdAt', f.createdFrom, FilterOperator.GREATER_OR_EQUAL)
        .add('createdAt', f.createdTo, FilterOperator.LESS_OR_EQUAL)
        .anyOf(['name', 'nif', 'email'], f.search)
        .orderBy(f.sort, { field: 'createdAt', direction: 'DESC' })
        .paginate(f.page, f.perPage)
        .build(),
    );
  }
  dropdown() {
    return this.q.activeDropdown();
  }
  withoutWallet() {
    return this.q.withoutWalletDropdown();
  }
  dashboard() {
    return this.q.dashboard();
  }
  /** dívida de um devedor (cartão "Dívida total" no detalhe) */
  debtSummary(debtorId: number) {
    return this.q.debtSummary(debtorId);
  }
}
