import { Controller, Get, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { resolveAuditReferences } from './audit-references';

export const AUDIT_VIEW_PERMISSION = 'audit_view_permission';

class AuditLogQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage: number = 20;
  @ApiPropertyOptional({ description: 'Pesquisa em acção, entidade, id do registo e IP' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) actorId?: number;
  @ApiPropertyOptional({ example: 'negotiation' }) @IsOptional() @IsString() @MaxLength(60) entity?: string;
  @ApiPropertyOptional({ example: '42' }) @IsOptional() @IsString() @MaxLength(60) entityId?: string;
  @ApiPropertyOptional({ example: 'PAYMENT_CONFIRMED' }) @IsOptional() @IsString() @MaxLength(80) action?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
}

/**
 * Leitura do trilho de auditoria (audit_logs é append-only; aqui só se consulta).
 * 1 query paginada com o nome/perfil do autor por JOIN (sem N+1).
 */
@ApiTags('Auditoria')
@ApiBearerAuth()
@RequirePermissions(AUDIT_VIEW_PERMISSION)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Listar eventos de auditoria (mais recentes primeiro)' })
  async list(@Query() q: AuditLogQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.actorId) where.push(`a.actor_id = ${p(q.actorId)}`);
    if (q.entity) where.push(`a.entity = ${p(q.entity)}`);
    if (q.entityId) where.push(`a.entity_id = ${p(q.entityId)}`);
    if (q.action) where.push(`a.action = ${p(q.action)}`);
    if (q.from) where.push(`a.created_at >= ${p(q.from)}::date`);
    if (q.to) where.push(`a.created_at < ${p(q.to)}::date + 1`);
    if (q.search) {
      const s = p(`%${q.search.trim()}%`);
      where.push(`(a.action ILIKE ${s} OR a.entity ILIKE ${s} OR a.entity_id ILIKE ${s} OR a.ip ILIKE ${s} OR u.full_name ILIKE ${s})`);
    }
    const sql = `
      SELECT a.id::text AS id, a.action, a.entity, a.entity_id AS "entityId", a.actor_id AS "actorId",
             u.full_name AS "actorName", u.email AS "actorEmail", r.name AS "actorRole",
             a.request_id AS "requestId", a.ip, a.payload, a.created_at AS "createdAt",
             count(*) OVER () AS total
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_id
        LEFT JOIN roles r ON r.id = u.role_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${p(q.perPage)} OFFSET ${p((q.page - 1) * q.perPage)}`;
    const rows: Array<Record<string, unknown> & { total: string }> = await this.ds.query(sql, params);
    const total = rows.length ? Number(rows[0].total) : 0;
    return {
      meta: { total, perPage: q.perPage, currentPage: q.page, lastPage: Math.max(1, Math.ceil(total / q.perPage)), firstPage: 1 },
      // ids do payload → nomes (devedor, utilizador, moeda…) numa query por tipo
      data: await resolveAuditReferences(this.ds, rows.map(({ total: _t, ...r }) => r as Record<string, unknown> & { entity: string; entityId: string | null; payload: Record<string, unknown> | null })),
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Resumo das últimas 24 horas' })
  async stats() {
    const [r] = await this.ds.query(`
      SELECT count(*)::int AS events,
             count(DISTINCT actor_id)::int AS users,
             count(*) FILTER (WHERE action LIKE '%LOGIN%')::int AS logins,
             count(*) FILTER (WHERE entity IN ('payment','negotiation','creditor_settlement'))::int AS financial
        FROM audit_logs WHERE created_at >= now() - interval '24 hours'`);
    const actions: Array<{ action: string }> = await this.ds.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    const entities: Array<{ entity: string }> = await this.ds.query('SELECT DISTINCT entity FROM audit_logs ORDER BY entity');
    return { data: { ...r, actions: actions.map((a) => a.action), entities: entities.map((e) => e.entity) } };
  }
}
