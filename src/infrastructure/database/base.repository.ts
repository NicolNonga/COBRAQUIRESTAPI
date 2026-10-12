import { DataSource, EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { txStorage } from './transaction-context';

/**
 * Base para repositórios TypeORM que participam automaticamente na
 * transacção corrente (se houver) — sem passar `manager` por parâmetro.
 */
export abstract class BaseTypeOrmRepository {
  protected constructor(protected readonly dataSource: DataSource) {}

  protected get manager(): EntityManager {
    return txStorage.getStore()?.manager ?? this.dataSource.manager;
  }

  protected repo<E extends ObjectLiteral>(entity: EntityTarget<E>): Repository<E> {
    return this.manager.getRepository(entity);
  }

  protected inTransaction(): boolean {
    return !!txStorage.getStore();
  }
}
