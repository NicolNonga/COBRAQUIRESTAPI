import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AUDITED_TABLES, AuditedTable, AuditEntry, AuditTrail } from '@/shared/application/audit-trail.port';
import { RequestContext } from '@/shared/application/request-context';
import { BaseTypeOrmRepository } from '../database/base.repository';
import { AuditLogOrmEntity } from './audit-log.orm-entity';

@Injectable()
export class TypeOrmAuditTrail extends BaseTypeOrmRepository implements AuditTrail {
  private readonly logger = new Logger('Audit');

  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async record(entry: AuditEntry): Promise<void> {
    const ctx = RequestContext.get();
    await this.repo(AuditLogOrmEntity).insert({
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      actorId: ctx?.userId ?? null,
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
      payload: (entry.payload ?? null) as never,
    });
    // também no log de sistema, para observabilidade centralizada
    this.logger.log({ audit: entry.action, entity: entry.entity, entityId: entry.entityId, actorId: ctx?.userId });
  }

  async snapshot(table: AuditedTable, where: Record<string, number>): Promise<Record<string, unknown> | null> {
    if (!(AUDITED_TABLES as readonly string[]).includes(table)) throw new Error(`Tabela não auditável: ${table}`);
    const cols = Object.keys(where);
    if (!cols.length || cols.some((c) => !/^[a-z_]+$/.test(c))) throw new Error('Filtro de snapshot inválido');
    // to_jsonb: datas chegam como "2026-11-05" (sem desvio de fuso) e numéricos sem perder o formato
    const rows: Array<{ row: Record<string, unknown> }> = await this.manager.query(
      `SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${cols.map((c, i) => `t.${c} = $${i + 1}`).join(' AND ')} LIMIT 1`,
      cols.map((c) => where[c]),
    );
    if (!rows[0]) return null;
    return Object.fromEntries(Object.entries(rows[0].row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
  }
}
