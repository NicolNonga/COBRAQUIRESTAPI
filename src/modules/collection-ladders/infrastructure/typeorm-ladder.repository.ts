import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { ConflictError } from '@/shared/domain/errors';
import { buildPage, Page } from '@/shared/domain/pagination';
import { LadderStepInput } from '../domain/ladder';
import { DueLadderStep, Ladder, LadderEngine, LadderPreviewRow, LadderCoverageRow, LadderRepository, LimitExceededRow } from '../domain/ladder.repository';
import { CollectionLadderOrmEntity, CollectionLadderStepOrmEntity } from './ladder.orm-entities';

const toStepRow = (ladderId: number, s: LadderStepInput) => ({
  ladderId,
  dayOffset: s.dayOffset,
  actionType: s.actionType,
  recipients: s.recipients,
  priority: s.priority,
  title: s.title.trim(),
  messageTemplate: s.messageTemplate.trim(),
  fulfillmentDays: s.fulfillmentDays ?? null,
  debtorChannel: s.debtorChannel ?? 'NONE',
  debtorSubject: s.debtorSubject ?? null,
  debtorMessageTemplate: s.debtorMessageTemplate ?? null,
});

@Injectable()
export class TypeOrmLadderRepository extends BaseTypeOrmRepository implements LadderRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async create(ownerUserId: number, data: { name: string; description: string | null; policyVersion: number }, steps: LadderStepInput[]): Promise<Ladder> {
    const ladder = await this.repo(CollectionLadderOrmEntity).save(
      this.repo(CollectionLadderOrmEntity).create({ ownerUserId, name: data.name.trim(), description: data.description, isActive: false, policyVersion: data.policyVersion, policyCompliant: true, policyViolations: null }),
    );
    await this.repo(CollectionLadderStepOrmEntity).insert(steps.map((s) => toStepRow(ladder.id, s)));
    return ladder;
  }

  async findById(id: number): Promise<Ladder | null> {
    const l = await this.repo(CollectionLadderOrmEntity).findOne({ where: { id } });
    if (!l) return null;
    l.steps = await this.repo(CollectionLadderStepOrmEntity).find({ where: { ladderId: id, removedAt: IsNull() }, order: { dayOffset: 'ASC' } });
    return l;
  }

  findForUpdate(id: number): Promise<Ladder | null> {
    return this.repo(CollectionLadderOrmEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  async replaceSteps(id: number, data: { name: string; description: string | null; policyVersion: number }, steps: LadderStepInput[]): Promise<void> {
    const days = steps.map((s) => s.dayOffset);
    // 1) remoção lógica das etapas cujo dia desapareceu (as execuções antigas continuam válidas)
    await this.manager.query(
      `UPDATE collection_ladder_steps SET removed_at = now(), updated_at = now()
        WHERE ladder_id = $1 AND removed_at IS NULL AND NOT (day_offset = ANY($2::int[]))`,
      [id, days],
    );
    // 2) upsert por dia: mesmo dia mantém o id → um passo já executado num processo não volta a disparar
    await this.manager.query(
      `INSERT INTO collection_ladder_steps (ladder_id, day_offset, action_type, recipients, priority, title, message_template, fulfillment_days,
                                           debtor_channel, debtor_subject, debtor_message_template)
       SELECT $1, d, a, r, p, t, m, f, dc, ds, dm
         FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::text[], $10::text[], $11::text[])
              AS x(d, a, r, p, t, m, f, dc, ds, dm)
       ON CONFLICT (ladder_id, day_offset) WHERE removed_at IS NULL
       DO UPDATE SET action_type = EXCLUDED.action_type, recipients = EXCLUDED.recipients, priority = EXCLUDED.priority,
                     title = EXCLUDED.title, message_template = EXCLUDED.message_template,
                     fulfillment_days = EXCLUDED.fulfillment_days, debtor_channel = EXCLUDED.debtor_channel,
                     debtor_subject = EXCLUDED.debtor_subject, debtor_message_template = EXCLUDED.debtor_message_template, updated_at = now()`,
      [
        id,
        days,
        steps.map((s) => s.actionType),
        steps.map((s) => s.recipients),
        steps.map((s) => s.priority),
        steps.map((s) => s.title.trim()),
        steps.map((s) => s.messageTemplate.trim()),
        steps.map((s) => s.fulfillmentDays ?? null),
        steps.map((s) => s.debtorChannel ?? 'NONE'),
        steps.map((s) => s.debtorSubject ?? null),
        steps.map((s) => s.debtorMessageTemplate ?? null),
      ],
    );
    await this.manager.query(
      `UPDATE collection_ladders SET name = $2, description = $3, version = version + 1, policy_version = $4,
              policy_compliant = true, policy_violations = NULL, updated_at = now() WHERE id = $1`,
      [id, data.name.trim(), data.description, data.policyVersion],
    );
  }

  async setActive(id: number, active: boolean): Promise<void> {
    try {
      await this.manager.query('UPDATE collection_ladders SET is_active = $2, updated_at = now() WHERE id = $1', [id, active]);
    } catch (e) {
      if (isUniqueViolation(e, 'ux_collection_ladders_active_owner')) throw new ConflictError('Já existe outra régua activa');
      throw e;
    }
  }

  async deactivateOthers(ownerUserId: number, exceptId: number): Promise<void> {
    await this.manager.query(
      'UPDATE collection_ladders SET is_active = false, updated_at = now() WHERE owner_user_id = $1 AND id <> $2 AND is_active',
      [ownerUserId, exceptId],
    );
  }

  async archive(id: number): Promise<void> {
    await this.manager.query('UPDATE collection_ladders SET is_active = false, archived_at = now(), updated_at = now() WHERE id = $1', [id]);
  }

  async listByOwner(ownerUserId: number, includeArchived: boolean, page: number, perPage: number): Promise<Page<Ladder>> {
    const [rows, total] = await this.repo(CollectionLadderOrmEntity).findAndCount({
      where: { ownerUserId, ...(includeArchived ? {} : { archivedAt: IsNull() }) },
      order: { isActive: 'DESC', updatedAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    if (rows.length) {
      // etapas de todas as réguas da página numa única query (sem N+1)
      const steps = await this.repo(CollectionLadderStepOrmEntity)
        .createQueryBuilder('s')
        .where('s.ladder_id = ANY(:ids) AND s.removed_at IS NULL', { ids: rows.map((r) => r.id) })
        .orderBy('s.day_offset', 'ASC')
        .getMany();
      rows.forEach((r) => (r.steps = steps.filter((s) => s.ladderId === r.id)));
    }
    return buildPage(rows, total, { page, perPage });
  }

  async listAllWithSteps(): Promise<Ladder[]> {
    const rows = await this.repo(CollectionLadderOrmEntity).find({ where: { archivedAt: IsNull() } });
    if (rows.length) {
      const steps = await this.repo(CollectionLadderStepOrmEntity)
        .createQueryBuilder('s')
        .where('s.ladder_id = ANY(:ids) AND s.removed_at IS NULL', { ids: rows.map((r) => r.id) })
        .getMany();
      rows.forEach((r) => (r.steps = steps.filter((s) => s.ladderId === r.id)));
    }
    return rows;
  }

  async setCompliance(id: number, compliant: boolean, violations: Array<{ code: string; message: string; dayOffset?: number }> | null, policyVersion: number): Promise<void> {
    await this.manager.query(
      'UPDATE collection_ladders SET policy_compliant = $2, policy_violations = $3::jsonb, policy_version = $4, updated_at = now() WHERE id = $1',
      [id, compliant, violations && violations.length ? JSON.stringify(violations) : null, policyVersion],
    );
  }

  async executionsCount(id: number): Promise<number> {
    const [r] = await this.manager.query('SELECT count(*)::int AS n FROM collection_ladder_executions WHERE ladder_id = $1', [id]);
    return r.n;
  }
}

/** dia do processo = dias (calendário de Luanda) desde a entrada em cobrança */
const PROCESS_DAY = `(CAST($1 AS date) - (p.start_date AT TIME ZONE 'Africa/Luanda')::date)`;
const TOTALS = `CROSS JOIN LATERAL (
    SELECT COALESCE(sum(i.amount), 0)::numeric(18,2)::text AS total, count(*)::int AS n
      FROM process_invoices pi JOIN invoices i ON i.id = pi.invoice_id WHERE pi.process_id = d.process_id
  ) agg`;

@Injectable()
export class TypeOrmLadderEngine extends BaseTypeOrmRepository implements LadderEngine {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  /**
   * Um único statement para todos os processos:
   *  processos abertos com responsável → régua activa do responsável → etapas na janela
   *  [dia - catchUp, dia] → INSERT nas execuções com ON CONFLICT (idempotência) → devolve só
   *  o que foi efectivamente registado agora (outra réplica que corra em paralelo não recebe nada).
   */
  claimDueSteps(today: string, catchUpDays: number): Promise<DueLadderStep[]> {
    return this.manager.query(
      `WITH proc AS (
         SELECT p.id AS process_id, p.debtor_id, pa.user_id AS agent_id, wa.manager_id, ${PROCESS_DAY} AS day
           FROM processes p
           JOIN process_assignments pa ON pa.process_id = p.id
           LEFT JOIN wallet_agents wa ON wa.agent_id = pa.user_id
          WHERE p.closed_at IS NULL AND p.start_date IS NOT NULL
       ), due AS (
         SELECT pr.*, s.id AS step_id, l.id AS ladder_id, l.version, s.day_offset, s.action_type,
                s.recipients, s.priority, s.title, s.message_template, s.fulfillment_days,
                s.debtor_channel, s.debtor_subject, s.debtor_message_template
           FROM proc pr
           JOIN collection_ladders l ON l.owner_user_id = pr.agent_id AND l.is_active AND l.policy_compliant
           JOIN collection_ladder_steps s ON s.ladder_id = l.id AND s.removed_at IS NULL
                                         AND s.day_offset BETWEEN pr.day - $2 AND pr.day
       ), ins AS (
         INSERT INTO collection_ladder_executions (process_id, step_id, ladder_id, ladder_version, process_day, agent_id, status, due_on)
         SELECT process_id, step_id, ladder_id, version, day, agent_id,
                CASE WHEN fulfillment_days IS NULL THEN 'NOT_TRACKED' ELSE 'PENDING' END,
                CASE WHEN fulfillment_days IS NULL THEN NULL ELSE CAST($1 AS date) + fulfillment_days END
           FROM due
         ON CONFLICT (process_id, step_id) DO NOTHING
         RETURNING process_id, step_id
       )
       SELECT d.process_id AS "processId", d.step_id AS "stepId", d.day, d.agent_id AS "agentId", d.manager_id AS "managerId",
              d.action_type AS "actionType", d.recipients, d.priority, d.title, d.message_template AS "messageTemplate",
              deb.name AS "debtorName", agg.total AS "totalAmount", agg.n AS "invoicesCount",
              d.fulfillment_days AS "fulfillmentDays", d.debtor_id AS "debtorId", deb.email AS "debtorEmail", deb.phone_number AS "debtorPhone",
              d.debtor_channel AS "debtorChannel", d.debtor_subject AS "debtorSubject", d.debtor_message_template AS "debtorMessageTemplate"
         FROM due d
         JOIN ins USING (process_id, step_id)
         JOIN debtors deb ON deb.id = d.debtor_id
         ${TOTALS}
        ORDER BY d.process_id, d.day_offset`,
      [today, catchUpDays],
    );
  }

  preview(ladderId: number, ownerUserId: number, today: string, catchUpDays: number): Promise<LadderPreviewRow[]> {
    return this.manager.query(
      `WITH proc AS (
         SELECT p.id AS process_id, p.debtor_id, ${PROCESS_DAY} AS day
           FROM processes p JOIN process_assignments pa ON pa.process_id = p.id AND pa.user_id = $3
          WHERE p.closed_at IS NULL AND p.start_date IS NOT NULL
       ), d AS (
         SELECT pr.*, s.id AS step_id, s.day_offset, s.action_type, s.recipients, s.priority, s.title, s.message_template,
                s.debtor_channel, s.debtor_subject, s.debtor_message_template
           FROM proc pr
           JOIN collection_ladder_steps s ON s.ladder_id = $4 AND s.removed_at IS NULL
                                         AND s.day_offset BETWEEN pr.day - $2 AND pr.day
       )
       SELECT d.process_id AS "processId", d.step_id AS "stepId", d.day, d.action_type AS "actionType", d.recipients,
              d.priority, d.title, d.message_template AS "messageTemplate", deb.name AS "debtorName",
              agg.total AS "totalAmount", agg.n AS "invoicesCount",
              d.debtor_channel AS "debtorChannel", d.debtor_subject AS "debtorSubject", d.debtor_message_template AS "debtorMessageTemplate",
              deb.email AS "debtorEmail", deb.phone_number AS "debtorPhone",
              EXISTS (SELECT 1 FROM collection_ladder_executions e WHERE e.process_id = d.process_id AND e.step_id = d.step_id) AS "alreadyExecuted"
         FROM d
         JOIN debtors deb ON deb.id = d.debtor_id
         ${TOTALS}
        ORDER BY d.process_id, d.day_offset`,
      [today, catchUpDays, ownerUserId, ladderId],
    );
  }

  coverage(ladderId: number, ownerUserId: number, today: string): Promise<LadderCoverageRow[]> {
    return this.manager.query(
      `SELECT p.id AS "processId", deb.name AS "debtorName", ${PROCESS_DAY} AS day,
              to_char(p.start_date AT TIME ZONE 'Africa/Luanda', 'YYYY-MM-DD') AS "startDate",
              EXISTS (SELECT 1 FROM negotiation_processes np WHERE np.process_id = p.id AND np.is_active) AS "hasActiveNegotiation",
              nx.day_offset AS "nextStepDay", nx.title AS "nextStepTitle",
              (SELECT max(s.day_offset) FROM collection_ladder_steps s WHERE s.ladder_id = $3 AND s.removed_at IS NULL) AS "lastStepDay"
         FROM processes p
         JOIN process_assignments pa ON pa.process_id = p.id AND pa.user_id = $2
         JOIN debtors deb ON deb.id = p.debtor_id
         LEFT JOIN LATERAL (
           SELECT s.day_offset, s.title FROM collection_ladder_steps s
            WHERE s.ladder_id = $3 AND s.removed_at IS NULL AND s.day_offset > ${PROCESS_DAY}
            ORDER BY s.day_offset LIMIT 1
         ) nx ON true
        WHERE p.closed_at IS NULL AND p.start_date IS NOT NULL
        ORDER BY p.id DESC
        LIMIT 50`,
      [today, ownerUserId, ladderId],
    );
  }

  claimLimitExceeded(today: string): Promise<LimitExceededRow[]> {
    return this.manager.query(
      `WITH hit AS (
         SELECT p.id AS process_id, deb.name AS debtor_name, pa.user_id AS agent_id, wa.manager_id, ${PROCESS_DAY} AS day, cp.max_collection_days AS max_days
           FROM processes p
           JOIN collection_policies cp ON cp.id = 1
           JOIN debtors deb ON deb.id = p.debtor_id
           LEFT JOIN process_assignments pa ON pa.process_id = p.id
           LEFT JOIN wallet_agents wa ON wa.agent_id = pa.user_id
          WHERE p.closed_at IS NULL AND p.start_date IS NOT NULL AND p.policy_limit_notified_at IS NULL
            AND ${PROCESS_DAY} > cp.max_collection_days
       ), upd AS (
         UPDATE processes SET policy_limit_notified_at = now()
          WHERE id IN (SELECT process_id FROM hit) AND policy_limit_notified_at IS NULL
         RETURNING id
       )
       SELECT h.process_id AS "processId", h.debtor_name AS "debtorName", h.agent_id AS "agentId", h.manager_id AS "managerId",
              h.day, h.max_days AS "maxDays"
         FROM hit h JOIN upd ON upd.id = h.process_id`,
      [today],
    );
  }
}
