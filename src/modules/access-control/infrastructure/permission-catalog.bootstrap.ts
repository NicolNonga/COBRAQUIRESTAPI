import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { syncPermissionCatalog } from './permission-catalog.sync';

/** No arranque da API mantém a tabela `permissions` igual ao catálogo do código. */
@Injectable()
export class PermissionCatalogBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger('Permissões');
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const { created } = await this.ds.transaction((m) => syncPermissionCatalog((sql, p) => m.query(sql, p)));
      this.logger.log(created.length ? `Catálogo sincronizado; novas: ${created.join(', ')}` : 'Catálogo de permissões sincronizado');
    } catch (e) {
      this.logger.error(`Falha ao sincronizar o catálogo de permissões: ${(e as Error).message}`);
    }
  }
}
