import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { auditDiff, prefixed } from '@/shared/application/audit-diff';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { NotFoundError, ValidationError } from '@/shared/domain/errors';
import { CurrencyAdminRepository, CurrencyRow, PaymentMethod, PaymentMethodRepository } from '../domain/payment.repository';

/**
 * Meios de pagamento configuráveis. Não se apagam (estão referenciados por pagamentos):
 * desactivar tira-os da lista de escolha no registo.
 */
@Injectable()
export class PaymentMethodsUseCase {
  constructor(private readonly repo: PaymentMethodRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  list(onlyActive: boolean): Promise<PaymentMethod[]> {
    return this.repo.list(onlyActive);
  }

  create(data: { name: string; description?: string | null; requiresReference: boolean }): Promise<PaymentMethod> {
    return this.uow.run(async () => {
      const m = await this.repo.create({ name: data.name, description: data.description ?? null, requiresReference: data.requiresReference });
      await this.audit.record({ action: 'PAYMENT_METHOD_CREATED', entity: 'payment_method', entityId: m.id, payload: { ...m } });
      return m;
    });
  }

  update(id: number, data: Partial<Omit<PaymentMethod, 'id'>>): Promise<void> {
    if (!Object.values(data).some((v) => v !== undefined)) throw new ValidationError('Nada para actualizar');
    return this.uow.run(async () => {
      const before = await this.audit.snapshot('payment_methods', { id });
      if (!(await this.repo.update(id, data))) throw new NotFoundError('Meio de pagamento não encontrado');
      const after = await this.audit.snapshot('payment_methods', { id });
      await this.audit.record({ action: 'PAYMENT_METHOD_UPDATED', entity: 'payment_method', entityId: id, payload: { ...auditDiff(before, after) } });
    });
  }
}

/** Moedas aceites no registo de pagamentos (o código ISO é imutável). */
@Injectable()
export class CurrenciesAdminUseCase {
  constructor(private readonly repo: CurrencyAdminRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  list(onlyActive: boolean): Promise<CurrencyRow[]> {
    return this.repo.list(onlyActive);
  }

  create(data: { code: string; name: string; symbol: string }): Promise<CurrencyRow> {
    return this.uow.run(async () => {
      const c = await this.repo.create(data);
      await this.audit.record({ action: 'CURRENCY_CREATED', entity: 'currency', entityId: c.id, payload: { ...c } });
      return c;
    });
  }

  update(id: number, data: Partial<Omit<CurrencyRow, 'id' | 'code'>>): Promise<void> {
    if (!Object.values(data).some((v) => v !== undefined)) throw new ValidationError('Nada para actualizar');
    return this.uow.run(async () => {
      const before = await this.audit.snapshot('currencies', { id });
      if (!(await this.repo.update(id, data))) throw new NotFoundError('Moeda não encontrada');
      const after = await this.audit.snapshot('currencies', { id });
      await this.audit.record({ action: 'CURRENCY_UPDATED', entity: 'currency', entityId: id, payload: { ...auditDiff(before, after) } });
    });
  }
}
