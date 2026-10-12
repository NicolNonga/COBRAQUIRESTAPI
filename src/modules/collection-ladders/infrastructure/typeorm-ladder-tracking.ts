import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { teamScopeSql } from '@/infrastructure/database/team-scope.sql';
import { TeamScope } from '@/shared/application/team-scope';
import { buildPage, Page } from '@/shared/domain/pagination';
import { ComplianceRow, LadderTask, LadderTaskFilter, LadderTracking, OverdueLadderTask } from '../domain/ladder-tracking';

/**
 * Todas as transições são UPDATE condicionais ao estado actual: duas réplicas a correr o job ao mesmo
 * tempo não duplicam nada (a segunda já não encontra as linhas no estado de origem).
 */
@Injectable()
export class TypeOrmLadderTracking extends BaseTypeOrmRepository implements LadderTracking {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async voidClosedProcesses(): Promise<number> {
    const [, n] = await this.manager.query(
      `UPDATE collection_ladder_executions e SET status = 'VOID'
         FROM processes p
        WHERE p.id = e.process_id AND p.closed_at IS NOT NULL AND e.status IN ('PENDING','OVERDUE')`,
    );
    return n;
  }

  async markFulfilled(): Promise<number> {
    const [, n] = await this.manager.query(
      `UPDATE collection_ladder_executions e
          SET status = 'FULFILLED', fulfilled_at = f.contacted_at, fulfilled_contact_id = f.contact_id,
              fulfilled_late = (f.contacted_at AT TIME ZONE 'Africa/Luanda')::date > e.due_on
         FROM (
           SELECT DISTINCT ON (x.id) x.id, c.id AS contact_id, c.contacted_at
             FROM collection_ladder_executions x
             JOIN contacts c ON c.process_id = x.process_id
                            AND c.contacted_at >= (date_trunc('day', x.executed_at AT TIME ZONE 'Africa/Luanda') AT TIME ZONE 'Africa/Luanda')
            WHERE x.status IN ('PENDING','OVERDUE')
            ORDER BY x.id, c.contacted_at, c.id
         ) f
        WHERE e.id = f.id AND e.status IN ('PENDING','OVERDUE')`,
    );
    return n;
  }

  markOverdue(today: string): Promise<OverdueLadderTask[]> {
    // CTE de UPDATE + SELECT final: o driver devolve as linhas do SELECT
    return this.manager.query(
      `WITH od AS (
         UPDATE collection_ladder_executions e
            SET status = 'OVERDUE', escalated_at = now(),
                -- escala para o responsável ACTUAL (o processo pode ter sido transferido)
                agent_id = COALESCE((SELECT pa.user_id FROM process_assignments pa WHERE pa.process_id = e.process_id), e.agent_id)
          WHERE e.status = 'PENDING' AND e.due_on < $1::date
         RETURNING e.id, e.process_id, e.agent_id, e.step_id, e.due_on
       )
       SELECT od.id::text AS "executionId", od.process_id AS "processId", od.agent_id AS "agentId", wa.manager_id AS "managerId",
              s.title, to_char(od.due_on, 'YYYY-MM-DD') AS "dueOn", d.name AS "debtorName"
         FROM od
         JOIN collection_ladder_steps s ON s.id = od.step_id
         JOIN processes p ON p.id = od.process_id
         JOIN debtors d ON d.id = p.debtor_id
         LEFT JOIN wallet_agents wa ON wa.agent_id = od.agent_id`,
      [today],
    );
  }

  async tasks(f: LadderTaskFilter): Promise<Page<LadderTask>> {
    const params: unknown[] = [
      f.statuses?.length ? f.statuses : null,
      f.agentId ?? null,
      f.ladderId ?? null,
      f.processId ?? null,
      f.dueFrom ?? null,
      f.dueTo ?? null,
    ];
    const scope = teamScopeSql('e.agent_id', f.scope, params.length + 1);
    params.push(...scope.params);
    const where = `e.status <> 'NOT_TRACKED'
      AND ($1::text[] IS NULL OR e.status = ANY($1::text[]))
      AND ($2::int IS NULL OR e.agent_id = $2) AND ($3::int IS NULL OR e.ladder_id = $3) AND ($4::int IS NULL OR e.process_id = $4)
      AND ($5::date IS NULL OR e.due_on >= $5::date) AND ($6::date IS NULL OR e.due_on <= $6::date)
      AND ${scope.sql}`;
    const rows = await this.manager.query(
      `SELECT e.id::text AS id, e.process_id AS "processId", d.name AS "debtorName", e.ladder_id AS "ladderId", e.step_id AS "stepId",
              s.title, s.action_type AS "actionType", e.process_day AS "processDay", e.executed_at AS "executedAt",
              to_char(e.due_on, 'YYYY-MM-DD') AS "dueOn", e.status, e.fulfilled_at AS "fulfilledAt", e.fulfilled_late AS "fulfilledLate",
              e.fulfilled_contact_id AS "fulfilledContactId", e.escalated_at AS "escalatedAt", e.agent_id AS "agentId", u.full_name AS "agentName"
         FROM collection_ladder_executions e
         JOIN collection_ladder_steps s ON s.id = e.step_id
         JOIN processes p ON p.id = e.process_id
         JOIN debtors d ON d.id = p.debtor_id
         LEFT JOIN users u ON u.id = e.agent_id
        WHERE ${where}
        ORDER BY CASE e.status WHEN 'OVERDUE' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END, e.due_on, e.id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.perPage, (f.page - 1) * f.perPage],
    );
    const [{ total }] = await this.manager.query(`SELECT count(*)::int AS total FROM collection_ladder_executions e WHERE ${where}`, params);
    return buildPage(rows, total, { page: f.page, perPage: f.perPage });
  }

  compliance(scope: TeamScope, from: string, to: string, agentId?: number): Promise<ComplianceRow[]> {
    const s = teamScopeSql('e.agent_id', scope, 4);
    return this.manager.query(
      `SELECT e.agent_id AS "agentId", u.full_name AS "agentName",
              count(*)::int AS tracked,
              count(*) FILTER (WHERE e.status = 'FULFILLED' AND NOT e.fulfilled_late)::int AS "fulfilledOnTime",
              count(*) FILTER (WHERE e.status = 'FULFILLED' AND e.fulfilled_late)::int AS "fulfilledLate",
              count(*) FILTER (WHERE e.status = 'OVERDUE')::int AS overdue,
              count(*) FILTER (WHERE e.status = 'PENDING')::int AS pending,
              count(*) FILTER (WHERE e.status = 'VOID')::int AS voided
         FROM collection_ladder_executions e
         LEFT JOIN users u ON u.id = e.agent_id
        WHERE e.status <> 'NOT_TRACKED'
          AND e.executed_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Luanda')
          AND e.executed_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda')
          AND ($3::int IS NULL OR e.agent_id = $3)
          AND ${s.sql}
        GROUP BY e.agent_id, u.full_name
        ORDER BY u.full_name NULLS LAST`,
      [from, to, agentId ?? null, ...s.params],
    );
  }
}
