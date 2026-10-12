import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ContactTypeWriter } from '../domain/catalog-reader.port';

@Injectable()
export class CreateContactTypeUseCase {
  constructor(
    private readonly writer: ContactTypeWriter,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: { name: string; description?: string }): Promise<{ id: number }> {
    return this.uow.run(async () => {
      const created = await this.writer.create(input);
      await this.audit.record({ action: 'CONTACT_TYPE_CREATED', entity: 'contact_type', entityId: created.id, payload: input });
      return created;
    });
  }
}
