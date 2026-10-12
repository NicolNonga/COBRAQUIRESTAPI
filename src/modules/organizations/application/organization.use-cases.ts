import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { auditDiff } from '@/shared/application/audit-diff';
import { FileStorage, UploadedBinary } from '@/shared/application/file-storage.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { NotFoundError } from '@/shared/domain/errors';
import { Criteria, Sort } from '@/shared/domain/criteria';
import { OrganizationField, OrganizationRepository } from '../domain/organization.repository';

export interface CreateOrganizationInput {
  name: string;
  email: string;
  phone_number: string;
  address: string;
  logo?: UploadedBinary;
}

@Injectable()
export class CreateOrganizationUseCase {
  constructor(
    private readonly orgs: OrganizationRepository,
    private readonly storage: FileStorage,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(input: CreateOrganizationInput) {
    const logoPath = input.logo ? await this.storage.save(input.logo, 'logos') : null;
    try {
      return await this.uow.run(async () => {
        const org = await this.orgs.create({
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          phoneNumber: input.phone_number.trim(),
          address: input.address.trim(),
          logoPath,
        });
        await this.audit.record({ action: 'ORGANIZATION_CREATED', entity: 'organization', entityId: org.id });
        return org;
      });
    } catch (e) {
      // compensação: não deixar ficheiros órfãos se a transacção falhar
      if (logoPath) await this.storage.remove(logoPath);
      throw e;
    }
  }
}

/** Editar credor: dados de contacto e, opcionalmente, um novo logótipo. */
@Injectable()
export class UpdateOrganizationUseCase {
  constructor(
    private readonly orgs: OrganizationRepository,
    private readonly storage: FileStorage,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(id: number, input: CreateOrganizationInput): Promise<void> {
    const current = await this.orgs.findById(id);
    if (!current) throw new NotFoundError('Credor não encontrado');
    const newLogo = input.logo ? await this.storage.save(input.logo, 'logos') : undefined;
    try {
      await this.uow.run(async () => {
        const before = await this.audit.snapshot('organizations', { id });
        await this.orgs.update(id, {
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          phoneNumber: input.phone_number.trim(),
          address: input.address.trim(),
          ...(newLogo ? { logoPath: newLogo } : {}),
        });
        const after = await this.audit.snapshot('organizations', { id });
        await this.audit.record({ action: 'ORGANIZATION_UPDATED', entity: 'organization', entityId: id, payload: { ...auditDiff(before, after) } });
        if (newLogo && current.logoPath) this.uow.afterCommit(() => this.storage.remove(current.logoPath!));
      });
    } catch (e) {
      if (newLogo) await this.storage.remove(newLogo);
      throw e;
    }
  }
}

@Injectable()
export class SetOrganizationActiveUseCase {
  constructor(private readonly orgs: OrganizationRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(id: number, active: boolean) {
    return this.uow.run(async () => {
      if (!(await this.orgs.setActive(id, active))) throw new NotFoundError('Organização não encontrada');
      await this.audit.record({ action: active ? 'ORGANIZATION_ENABLED' : 'ORGANIZATION_DISABLED', entity: 'organization', entityId: id, payload: { before: { isActive: !active }, after: { isActive: active } } });
    });
  }
}

@Injectable()
export class ListOrganizationsUseCase {
  constructor(private readonly orgs: OrganizationRepository) {}
  list(f: { page: number; perPage: number; search?: string; sort?: Sort<OrganizationField>[]; isActive?: boolean }) {
    return this.orgs.search(
      Criteria.for<OrganizationField>()
        .add('isActive', f.isActive)
        .anyOf(['name', 'email', 'phoneNumber'], f.search)
        .orderBy(f.sort, { field: 'createdAt', direction: 'DESC' })
        .paginate(f.page, f.perPage)
        .build(),
    );
  }
  dropdown() {
    return this.orgs.listActive();
  }
}
