import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { buildPage, offsetOf, Page, PageRequest } from '@/shared/domain/pagination';
import {
  CollectionLedger,
  CompanyCreditor,
  ExternalRef,
  ExternalRefRepository,
  IntegrationRun,
  IntegrationRunRepository,
  IntegrationSettings,
  IntegrationSettingsRepository,
  IntegrationStatus,
  InvoiceSnapshot,
  LocalInvoiceMatch,
  NewErpDebtor,
  NewErpInvoice,
  NewReview,
  ProcessCloseReason,
  ProcessSettlement,
  RefEntity,
  RefUpsert,
  ReviewItem,
  ReviewRepository,
  ReviewStatus,
  RunCounters,
  RunMode,
  RunReportLine,
  RunStatus,
  RunTrigger,
  SettingsPatch,
} from '../domain/integration.repository';
import { ReviewKind } from '../domain/reconciliation';

/* ───────────────────────────── configuração (linha única) ───────────────────────────── */

const SETTINGS_COLS = `provider, status, config, credentials_enc AS "credentialsEnc", auto_close AS "autoClose", import_debtors AS "importDebtors",
  interval_minutes AS "intervalMinutes", next_run_at AS "nextRunAt", last_run_at AS "lastRunAt", last_success_at AS "lastSuccessAt",
  last_full_run_at AS "lastFullRunAt", consecutive_failures AS "consecutiveFailures", cursors, actor_user_id AS "actorUserId",
  updated_by_id AS "updatedById", version, updated_at AS "updatedAt"`;

@Injectable()
export class TypeOrmIntegrationSettingsRepository extends BaseTypeOrmRepository implements IntegrationSettingsRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  private async load(lock: boolean): Promise<IntegrationSettings> {
    const [row] = await this.manager.query(`SELECT ${SETTINGS_COLS} FROM integration_settings WHERE id = 1${lock ? ' FOR UPDATE' : ''}`);
    const companies: CompanyCreditor[] = await this.manager.query(
      `SELECT c.company_code AS "companyCode", c.organization_id AS "organizationId", o.name AS "organizationName"
         FROM integration_company_creditors c JOIN organizations o ON o.id = c.organization_id ORDER BY c.company_code`,
    );
    return { ...row, companies };
  }

  get() {
    return this.load(false);
  }
  getForUpdate() {
    return this.load(true);
  }

  async update(p: SettingsPatch, expectedVersion: number, userId: number): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE integration_settings SET
          provider = COALESCE($1::varchar, provider), config = COALESCE($2::jsonb, config), auto_close = COALESCE($3::boolean, auto_close),
          import_debtors = COALESCE($4::boolean, import_debtors), interval_minutes = COALESCE($5::int, interval_minutes),
          updated_by_id = $6, version = version + 1, updated_at = now()
        WHERE id = 1 AND version = $7`,
      [p.provider ?? null, p.config ? JSON.stringify(p.config) : null, p.autoClose ?? null, p.importDebtors ?? null, p.intervalMinutes ?? null, userId, expectedVersion],
    );
    return n > 0;
  }

  async replaceCompanies(rows: CompanyCreditor[]): Promise<void> {
    await this.manager.query('DELETE FROM integration_company_creditors');
    if (!rows.length) return;
    await this.manager.query(
      `INSERT INTO integration_company_creditors (company_code, organization_id) SELECT * FROM unnest($1::text[], $2::int[])`,
      [rows.map((r) => r.companyCode), rows.map((r) => r.organizationId)],
    );
  }

  async createCreditors(rows: Array<{ companyCode: string; name: string; email: string | null; phone: string | null; address: string | null }>): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const r of rows) {
      const [org]: Array<{ id: number }> = await this.manager.query(
        `INSERT INTO organizations (name, email, phone_number, address) VALUES ($1, $2, $3, $4) RETURNING id`,
        [r.name.slice(0, 200), (r.email ?? '').slice(0, 254), (r.phone ?? '').slice(0, 30), r.address ?? ''],
      );
      await this.manager.query(
        `INSERT INTO integration_company_creditors (company_code, organization_id) VALUES ($1, $2) ON CONFLICT (company_code) DO NOTHING`,
        [r.companyCode, org.id],
      );
      out.set(r.companyCode, org.id);
    }
    return out;
  }

  async setCredentials(encrypted: string | null, userId: number): Promise<void> {
    await this.manager.query(
      'UPDATE integration_settings SET credentials_enc = $1, updated_by_id = $2, version = version + 1, updated_at = now() WHERE id = 1',
      [encrypted, userId],
    );
  }

  async setStatus(status: IntegrationStatus, userId: number | null, opts: { actorUserId?: number; nextRunAt?: Date | null } = {}): Promise<void> {
    await this.manager.query(
      `UPDATE integration_settings SET status = $1::varchar, updated_by_id = COALESCE($2::int, updated_by_id), actor_user_id = COALESCE($3::int, actor_user_id),
              next_run_at = CASE WHEN $5::boolean THEN $4::timestamptz ELSE next_run_at END,
              consecutive_failures = CASE WHEN $1::varchar = 'ACTIVE' THEN 0 ELSE consecutive_failures END,
              version = version + 1, updated_at = now()
        WHERE id = 1`,
      [status, userId, opts.actorUserId ?? null, opts.nextRunAt ?? null, opts.nextRunAt !== undefined],
    );
  }

  async saveCursor(key: string, value: string): Promise<void> {
    await this.manager.query(`UPDATE integration_settings SET cursors = cursors || jsonb_build_object($1::text, $2::text) WHERE id = 1`, [key, value]);
  }

  async recordOutcome(o: { ok: boolean; full: boolean; nextRunAt: Date }): Promise<number> {
    const [[row]] = await this.manager.query(
      `UPDATE integration_settings SET last_run_at = now(),
              last_success_at = CASE WHEN $1::boolean THEN now() ELSE last_success_at END,
              last_full_run_at = CASE WHEN $1::boolean AND $2::boolean THEN now() ELSE last_full_run_at END,
              consecutive_failures = CASE WHEN $1::boolean THEN 0 ELSE consecutive_failures + 1 END,
              next_run_at = $3::timestamptz
        WHERE id = 1 RETURNING consecutive_failures AS "failures"`,
      [o.ok, o.full, o.nextRunAt],
    );
    return row.failures;
  }
}

/* ───────────────────────────── execuções ───────────────────────────── */

const RUN_COLS = `r.id::int AS id, r.trigger, r.mode, r.provider, r.status, r.started_at AS "startedAt", r.finished_at AS "finishedAt",
  r.counters, r.error, r.triggered_by_id AS "triggeredById", coalesce(u.full_name, u.email) AS "triggeredByName"`;

/** Usa SEMPRE a ligação directa (fora da transacção da sincronização): uma simulação faz rollback, o registo fica. */
@Injectable()
export class TypeOrmIntegrationRunRepository implements IntegrationRunRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async failStale(): Promise<number> {
    const [, n] = await this.ds.query(
      `UPDATE integration_runs SET status = 'FAILED', finished_at = now(), error = 'Execução interrompida (a API parou a meio)' WHERE status = 'RUNNING'`,
    );
    return n;
  }

  async start(r: { trigger: RunTrigger; mode: RunMode; provider: string; triggeredById: number | null }): Promise<number> {
    const [row] = await this.ds.query(
      'INSERT INTO integration_runs (trigger, mode, provider, triggered_by_id) VALUES ($1, $2, $3, $4) RETURNING id::int AS id',
      [r.trigger, r.mode, r.provider, r.triggeredById],
    );
    return row.id;
  }

  async finish(id: number, r: { status: RunStatus; counters: RunCounters; report: RunReportLine[]; error: string | null }): Promise<void> {
    await this.ds.query('UPDATE integration_runs SET status = $2, counters = $3, report = $4, error = $5, finished_at = now() WHERE id = $1', [
      id,
      r.status,
      JSON.stringify(r.counters),
      JSON.stringify(r.report),
      r.error,
    ]);
  }

  async list(req: PageRequest): Promise<Page<IntegrationRun>> {
    const rows = await this.ds.query(
      `SELECT ${RUN_COLS}, '[]'::jsonb AS report FROM integration_runs r LEFT JOIN users u ON u.id = r.triggered_by_id
        ORDER BY r.started_at DESC LIMIT $1 OFFSET $2`,
      [req.perPage, offsetOf(req)],
    );
    const [{ total }] = await this.ds.query('SELECT count(*)::int AS total FROM integration_runs');
    return buildPage(rows, total, req);
  }

  async get(id: number): Promise<IntegrationRun | null> {
    const [row] = await this.ds.query(`SELECT ${RUN_COLS}, r.report FROM integration_runs r LEFT JOIN users u ON u.id = r.triggered_by_id WHERE r.id = $1`, [id]);
    return row ?? null;
  }

  async latest(): Promise<IntegrationRun | null> {
    const [row] = await this.ds.query(
      `SELECT ${RUN_COLS}, '[]'::jsonb AS report FROM integration_runs r LEFT JOIN users u ON u.id = r.triggered_by_id ORDER BY r.started_at DESC LIMIT 1`,
    );
    return row ?? null;
  }
}

/* ───────────────────────────── referências externas ───────────────────────────── */

const REF_COLS = `entity, external_id AS "externalId", local_id AS "localId", company_code AS "companyCode", external_status AS status,
  external_amount::text AS amount, external_open_amount::text AS "openAmount"`;

@Injectable()
export class TypeOrmExternalRefRepository extends BaseTypeOrmRepository implements ExternalRefRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async byExternalIds(entity: RefEntity, externalIds: string[]): Promise<Map<string, ExternalRef>> {
    if (!externalIds.length) return new Map();
    const rows: ExternalRef[] = await this.manager.query(`SELECT ${REF_COLS} FROM external_refs WHERE entity = $1 AND external_id = ANY($2)`, [entity, externalIds]);
    return new Map(rows.map((r) => [r.externalId, r]));
  }

  async byLocalIds(entity: RefEntity, localIds: number[]): Promise<Map<number, ExternalRef>> {
    if (!localIds.length) return new Map();
    const rows: ExternalRef[] = await this.manager.query(`SELECT ${REF_COLS} FROM external_refs WHERE entity = $1 AND local_id = ANY($2)`, [entity, localIds]);
    return new Map(rows.map((r) => [r.localId, r]));
  }

  async upsert(rows: RefUpsert[]): Promise<void> {
    if (!rows.length) return;
    await this.manager.query(
      `INSERT INTO external_refs (entity, external_id, local_id, company_code, external_status, external_amount, external_open_amount, linked_by, status_changed_at)
       SELECT e, x, l, c, s, a::numeric, o::numeric, b, now()
         FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS t(e, x, l, c, s, a, o, b)
       ON CONFLICT (entity, external_id) DO UPDATE SET
         external_status = EXCLUDED.external_status,
         external_amount = EXCLUDED.external_amount,
         external_open_amount = EXCLUDED.external_open_amount,
         company_code = COALESCE(EXCLUDED.company_code, external_refs.company_code),
         status_changed_at = CASE WHEN external_refs.external_status <> EXCLUDED.external_status THEN now() ELSE external_refs.status_changed_at END,
         last_seen_at = now(), updated_at = now()`,
      [
        rows.map((r) => r.entity),
        rows.map((r) => r.externalId),
        rows.map((r) => r.localId),
        rows.map((r) => r.companyCode),
        rows.map((r) => r.status),
        rows.map((r) => r.amount),
        rows.map((r) => r.openAmount),
        rows.map((r) => r.linkedBy),
      ],
    );
  }

  async openInvoicesNotSeenSince(since: Date, limit: number): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.manager.query(
      `SELECT external_id AS id FROM external_refs
        WHERE entity = 'INVOICE' AND external_status IN ('OPEN','PARTIAL') AND last_seen_at < $1
        ORDER BY last_seen_at LIMIT $2`,
      [since, limit],
    );
    return rows.map((r) => r.id);
  }

  async touch(entity: RefEntity, externalIds: string[]): Promise<void> {
    if (!externalIds.length) return;
    await this.manager.query('UPDATE external_refs SET last_seen_at = now() WHERE entity = $1 AND external_id = ANY($2)', [entity, externalIds]);
  }
}

/* ───────────────────────────── fila de revisão ───────────────────────────── */

const REVIEW_COLS = `r.id::int AS id, r.run_id::int AS "runId", r.kind, r.external_id AS "externalId", r.invoice_id AS "invoiceId",
  r.process_id AS "processId", r.summary, r.details, r.status, r.resolution, r.resolved_by_id AS "resolvedById",
  coalesce(u.full_name, u.email) AS "resolvedByName", r.resolved_at AS "resolvedAt", r.version, r.created_at AS "createdAt",
  i.reference_number AS "invoiceReference", d.name AS "debtorName"`;
const REVIEW_FROM = `FROM integration_review_items r
  LEFT JOIN users u ON u.id = r.resolved_by_id
  LEFT JOIN invoices i ON i.id = r.invoice_id
  LEFT JOIN debtors d ON d.id = i.debtor_id`;

@Injectable()
export class TypeOrmReviewRepository extends BaseTypeOrmRepository implements ReviewRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async open(items: NewReview[]): Promise<number> {
    if (!items.length) return 0;
    const rows = await this.manager.query(
      `INSERT INTO integration_review_items (run_id, kind, external_id, invoice_id, process_id, summary, details)
       SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::int[], $5::int[], $6::text[], $7::jsonb[]) AS t(run_id, kind, external_id, invoice_id, process_id, summary, details)
        -- não reabre um caso igual por resolver; "não encontrada no ERP" só abre uma vez (ignorada fica ignorada)
        WHERE NOT EXISTS (SELECT 1 FROM integration_review_items x
                           WHERE x.kind = t.kind AND x.external_id = t.external_id AND (x.status = 'OPEN' OR x.kind = 'MISSING_IN_ERP'))
       ON CONFLICT (kind, external_id) WHERE status = 'OPEN' DO NOTHING
       RETURNING id`,
      [
        items.map((i) => i.runId),
        items.map((i) => i.kind),
        items.map((i) => i.externalId),
        items.map((i) => i.invoiceId),
        items.map((i) => i.processId),
        items.map((i) => i.summary),
        items.map((i) => JSON.stringify(i.details ?? {})),
      ],
    );
    return rows.length;
  }

  async search(f: { status?: ReviewStatus; kind?: ReviewKind }, req: PageRequest): Promise<Page<ReviewItem>> {
    const where = ['($1::text IS NULL OR r.status = $1)', '($2::text IS NULL OR r.kind = $2)'].join(' AND ');
    const params = [f.status ?? null, f.kind ?? null];
    const rows = await this.manager.query(`SELECT ${REVIEW_COLS} ${REVIEW_FROM} WHERE ${where} ORDER BY r.created_at DESC LIMIT $3 OFFSET $4`, [
      ...params,
      req.perPage,
      offsetOf(req),
    ]);
    const [{ total }] = await this.manager.query(`SELECT count(*)::int AS total FROM integration_review_items r WHERE ${where}`, params);
    return buildPage(rows, total, req);
  }

  async findForUpdate(id: number): Promise<ReviewItem | null> {
    const [row] = await this.manager.query(`SELECT ${REVIEW_COLS} ${REVIEW_FROM} WHERE r.id = $1 FOR UPDATE OF r`, [id]);
    return row ?? null;
  }

  async resolve(id: number, version: number, status: Exclude<ReviewStatus, 'OPEN'>, resolution: string, userId: number): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE integration_review_items SET status = $3, resolution = $4, resolved_by_id = $5, resolved_at = now(), version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'OPEN'`,
      [id, version, status, resolution, userId],
    );
    return n > 0;
  }

  async countOpen(): Promise<number> {
    const [{ n }] = await this.manager.query(`SELECT count(*)::int AS n FROM integration_review_items WHERE status = 'OPEN'`);
    return n;
  }
}

/* ───────────────────────────── escritas nas tabelas de cobrança ───────────────────────────── */

const UNSETTLED = `SELECT 1 FROM process_invoices pi JOIN invoices i ON i.id = pi.invoice_id JOIN invoice_states s ON s.id = i.invoice_state_id
                    WHERE pi.process_id = p.id AND s.code NOT IN ('PAID','CANCELLED')`;
const AGREEMENT = `SELECT 1 FROM negotiation_processes np WHERE np.process_id = p.id AND np.is_active`;
const HAS_INVOICES = `SELECT 1 FROM process_invoices pi WHERE pi.process_id = p.id`;

@Injectable()
export class TypeOrmCollectionLedger extends BaseTypeOrmRepository implements CollectionLedger {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async invoiceSnapshots(invoiceIds: number[]): Promise<Map<number, InvoiceSnapshot>> {
    if (!invoiceIds.length) return new Map();
    const rows: InvoiceSnapshot[] = await this.manager.query(
      `SELECT i.id AS "invoiceId", i.reference_number AS reference, s.code AS state, i.amount::text AS amount, i.debtor_id AS "debtorId",
              p.id AS "processId", (p.id IS NOT NULL AND EXISTS (${AGREEMENT})) AS "agreementActive"
         FROM invoices i
         JOIN invoice_states s ON s.id = i.invoice_state_id
         LEFT JOIN process_invoices pi ON pi.invoice_id = i.id
         LEFT JOIN processes p ON p.id = pi.process_id AND p.closed_at IS NULL
        WHERE i.id = ANY($1)
        FOR UPDATE OF i`,
      [invoiceIds],
    );
    return new Map(rows.map((r) => [r.invoiceId, r]));
  }

  async setInvoiceState(invoiceIds: number[], state: 'PAID' | 'CANCELLED'): Promise<void> {
    if (!invoiceIds.length) return;
    await this.manager.query(
      `UPDATE invoices SET invoice_state_id = (SELECT id FROM invoice_states WHERE code = $2), updated_at = now() WHERE id = ANY($1)`,
      [invoiceIds, state],
    );
  }

  async updateInvoiceAmount(invoiceId: number, amount: string): Promise<boolean> {
    const [, n] = await this.manager.query(
      'UPDATE invoices SET amount = $2::numeric, updated_at = now() WHERE id = $1 AND $2::numeric > 0 AND amount <> $2::numeric',
      [invoiceId, amount],
    );
    return n > 0;
  }

  async processSettlements(processIds: number[]): Promise<ProcessSettlement[]> {
    if (!processIds.length) return [];
    return this.manager.query(
      `SELECT p.id AS "processId",
              (EXISTS (${HAS_INVOICES}) AND NOT EXISTS (${UNSETTLED})) AS "allSettled",
              EXISTS (${AGREEMENT}) AS "agreementActive",
              d.name AS "debtorName", pa.user_id AS "agentId",
              (SELECT wa.manager_id FROM wallet_agents wa WHERE wa.agent_id = pa.user_id ORDER BY wa.id LIMIT 1) AS "managerId"
         FROM processes p
         JOIN debtors d ON d.id = p.debtor_id
         LEFT JOIN process_assignments pa ON pa.process_id = p.id
        WHERE p.id = ANY($1) AND p.closed_at IS NULL`,
      [processIds],
    );
  }

  async closeProcess(processId: number, reason: ProcessCloseReason): Promise<boolean> {
    // UPDATE … RETURNING devolve [linhas, contagem] no driver pg do TypeORM
    const [, n] = await this.manager.query(
      `UPDATE processes p SET closed_at = now(), end_date = now(), closed_reason = $2, updated_at = now(),
              process_state_id = (SELECT id FROM process_states WHERE code = 'FINISHED')
        WHERE p.id = $1 AND p.closed_at IS NULL
          AND NOT EXISTS (${AGREEMENT}) AND EXISTS (${HAS_INVOICES}) AND NOT EXISTS (${UNSETTLED})
        RETURNING p.id`,
      [processId, reason],
    );
    return n > 0;
  }

  invoicesByReference(references: string[]): Promise<LocalInvoiceMatch[]> {
    if (!references.length) return Promise.resolve([]);
    return this.manager.query(
      `SELECT i.id AS "invoiceId", i.reference_number AS reference, i.debtor_id AS "debtorId", d.nif AS "debtorNif",
              d.organization_id AS "organizationId", i.amount::text AS amount
         FROM invoices i JOIN debtors d ON d.id = i.debtor_id
        WHERE lower(i.reference_number) = ANY($1)`,
      [references.map((r) => r.toLowerCase())],
    );
  }

  unlinkedOpenInvoices(afterId: number, limit: number): Promise<Array<{ invoiceId: number; reference: string }>> {
    return this.manager.query(
      `SELECT i.id AS "invoiceId", i.reference_number AS reference
         FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id
        WHERE i.id > $1 AND s.code NOT IN ('PAID','CANCELLED')
          AND NOT EXISTS (SELECT 1 FROM external_refs r WHERE r.entity = 'INVOICE' AND r.local_id = i.id)
        ORDER BY i.id LIMIT $2`,
      [afterId, limit],
    );
  }

  async debtorsByNif(nifs: string[]): Promise<Map<string, { debtorId: number; organizationId: number; name: string }>> {
    if (!nifs.length) return new Map();
    const rows: Array<{ key: string; debtorId: number; organizationId: number; name: string }> = await this.manager.query(
      `SELECT upper(regexp_replace(nif, '\\s', '', 'g')) AS key, id AS "debtorId", organization_id AS "organizationId", name
         FROM debtors WHERE nif IS NOT NULL AND upper(regexp_replace(nif, '\\s', '', 'g')) = ANY($1)`,
      [nifs],
    );
    return new Map(rows.map((r) => [r.key, r]));
  }

  async createDebtor(d: NewErpDebtor): Promise<number | null> {
    const rows: Array<{ id: number }> = await this.manager.query(
      `WITH t AS (SELECT id FROM debtor_types WHERE is_company = $6 ORDER BY id LIMIT 1),
            ins AS (
              INSERT INTO debtors (name, nif, email, phone_number, address, is_company, organization_id, debtor_type_id)
              SELECT $1, $2, $3, $4, $5, $6, $7, t.id FROM t
              ON CONFLICT DO NOTHING
              RETURNING id)
       INSERT INTO debtor_contact_persons (debtor_id, name, email, contact, position)
       SELECT id, left($1, 150), $3, left($4, 50), 'Contacto principal (ERP)' FROM ins
       RETURNING debtor_id AS id`,
      [d.name, d.nif, d.email, d.phone, d.address, d.isCompany, d.organizationId],
    );
    return rows[0]?.id ?? null;
  }

  async createInvoice(i: NewErpInvoice): Promise<number | null> {
    const rows: Array<{ id: number }> = await this.manager.query(
      `INSERT INTO invoices (reference_number, amount, issue_date, time_limit_days, due_date, debtor_id, currency_id, invoice_state_id, created_by_id)
       VALUES ($1, $2::numeric, $3::date, $4, $5::date, $6, $7, (SELECT id FROM invoice_states WHERE code = 'IN_PROGRESS'), $8)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [i.reference, i.amount, i.issueDate, i.timeLimitDays, i.dueDate, i.debtorId, i.currencyId, i.createdById],
    );
    return rows[0]?.id ?? null;
  }

  async currencyIds(): Promise<Map<string, number>> {
    const rows: Array<{ code: string; id: number }> = await this.manager.query('SELECT upper(code) AS code, id FROM currencies WHERE is_active');
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  async integrationManagers(): Promise<number[]> {
    const rows: Array<{ id: number }> = await this.manager.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
         JOIN permissions pm ON pm.id = rp.permission_id
        WHERE u.is_active AND pm.slug = 'integration_manage_permission'`,
    );
    return rows.map((r) => r.id);
  }
}
