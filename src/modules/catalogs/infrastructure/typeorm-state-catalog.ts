import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MisconfigurationError } from '@/shared/domain/errors';
import { StateCatalog } from '../domain/state-catalog.port';
import {
  InvoiceStateCode,
  InvoiceStateOrmEntity,
  ProcessStateCode,
  ProcessStateOrmEntity,
} from './catalog.orm-entities';

/**
 * Estados são dados de referência quase imutáveis: carregamos uma vez e
 * guardamos em cache, eliminando 1–2 queries por pedido/job (o original
 * fazia `InvoiceState.query().where('name', ...)` em cada chamada).
 */
@Injectable()
export class TypeOrmStateCatalog extends StateCatalog {
  private invoiceStates?: Map<string, number>;
  private processStates?: Map<string, number>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    super();
  }

  async invoiceStateId(code: InvoiceStateCode): Promise<number> {
    this.invoiceStates ??= new Map(
      (await this.ds.getRepository(InvoiceStateOrmEntity).find()).map((s) => [s.code, s.id]),
    );
    const id = this.invoiceStates.get(code);
    if (!id) throw new MisconfigurationError(`Estado de factura '${code}' não configurado (execute o seed)`);
    return id;
  }

  async processStateId(code: ProcessStateCode): Promise<number> {
    this.processStates ??= new Map(
      (await this.ds.getRepository(ProcessStateOrmEntity).find()).map((s) => [s.code, s.id]),
    );
    const id = this.processStates.get(code);
    if (!id) throw new MisconfigurationError(`Estado de processo '${code}' não configurado (execute o seed)`);
    return id;
  }
}
