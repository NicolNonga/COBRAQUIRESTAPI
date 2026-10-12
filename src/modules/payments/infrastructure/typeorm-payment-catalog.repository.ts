import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CurrencyOrmEntity } from '@/modules/catalogs/infrastructure/catalog.orm-entities';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { ConflictError } from '@/shared/domain/errors';
import { CurrencyAdminRepository, CurrencyRow, PaymentMethod, PaymentMethodRepository } from '../domain/payment.repository';
import { PaymentMethodOrmEntity } from './payment.orm-entities';

const METHOD_COLUMNS: (keyof PaymentMethodOrmEntity)[] = ['id', 'name', 'description', 'requiresReference', 'isActive'];
const CURRENCY_COLUMNS: (keyof CurrencyOrmEntity)[] = ['id', 'code', 'name', 'symbol', 'isActive'];

@Injectable()
export class TypeOrmPaymentMethodRepository extends BaseTypeOrmRepository implements PaymentMethodRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  findActive(id: number): Promise<PaymentMethod | null> {
    return this.repo(PaymentMethodOrmEntity).findOne({ where: { id, isActive: true }, select: METHOD_COLUMNS });
  }

  list(onlyActive: boolean): Promise<PaymentMethod[]> {
    return this.repo(PaymentMethodOrmEntity).find({ where: onlyActive ? { isActive: true } : {}, order: { name: 'ASC' }, select: METHOD_COLUMNS });
  }

  async create(data: Omit<PaymentMethod, 'id' | 'isActive'>): Promise<PaymentMethod> {
    const r = this.repo(PaymentMethodOrmEntity);
    try {
      const m = await r.save(r.create({ ...data, name: data.name.trim() }));
      return { id: m.id, name: m.name, description: m.description, requiresReference: m.requiresReference, isActive: m.isActive };
    } catch (e) {
      if (isUniqueViolation(e, 'ux_payment_methods_name')) throw new ConflictError('Já existe um meio de pagamento com este nome');
      throw e;
    }
  }

  async update(id: number, data: Partial<Omit<PaymentMethod, 'id'>>): Promise<boolean> {
    const patch = data.name !== undefined ? { ...data, name: data.name.trim() } : data;
    try {
      return ((await this.repo(PaymentMethodOrmEntity).update({ id }, patch)).affected ?? 0) > 0;
    } catch (e) {
      if (isUniqueViolation(e, 'ux_payment_methods_name')) throw new ConflictError('Já existe um meio de pagamento com este nome');
      throw e;
    }
  }
}

@Injectable()
export class TypeOrmCurrencyAdminRepository extends BaseTypeOrmRepository implements CurrencyAdminRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  findActive(id: number): Promise<CurrencyRow | null> {
    return this.repo(CurrencyOrmEntity).findOne({ where: { id, isActive: true }, select: CURRENCY_COLUMNS });
  }

  list(onlyActive: boolean): Promise<CurrencyRow[]> {
    return this.repo(CurrencyOrmEntity).find({ where: onlyActive ? { isActive: true } : {}, order: { code: 'ASC' }, select: CURRENCY_COLUMNS });
  }

  async create(data: Omit<CurrencyRow, 'id' | 'isActive'>): Promise<CurrencyRow> {
    const r = this.repo(CurrencyOrmEntity);
    const code = data.code.trim().toUpperCase();
    try {
      const c = await r.save(r.create({ code, name: data.name.trim(), symbol: data.symbol.trim() }));
      return { id: c.id, code: c.code, name: c.name, symbol: c.symbol, isActive: c.isActive };
    } catch (e) {
      if (isUniqueViolation(e, 'ux_currencies_code')) throw new ConflictError(`A moeda ${code} já existe`);
      throw e;
    }
  }

  /** o código ISO não muda: está referenciado por facturas e pagamentos */
  async update(id: number, data: Partial<Omit<CurrencyRow, 'id' | 'code'>>): Promise<boolean> {
    return ((await this.repo(CurrencyOrmEntity).update({ id }, data)).affected ?? 0) > 0;
  }
}
