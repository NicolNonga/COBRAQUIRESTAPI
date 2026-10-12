import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { isUniqueViolation } from '@/infrastructure/database/pg-errors';
import { Criteria } from '@/shared/domain/criteria';
import { ConflictError } from '@/shared/domain/errors';
import { buildPage, Page } from '@/shared/domain/pagination';
import {
  CreditorAccounts,
  CreditorBalance,
  CreditorBalanceField,
  CreditorLedger,
  CreditorLedgerEntry,
  LedgerLine,
} from '../domain/creditor-ledger.port';
import { NewSettlement, Settlement, SettlementField, SettlementRepository } from '../domain/settlement';

const BALANCE_FIELDS = new CriteriaCompiler<CreditorBalanceField>({
  organizationId: { column: 'o.id', type: 'number' },
  organizationName: { column: 'o.name', searchable: true },
});

/** saldo e componentes por credor; LATERAL usa ix_creditor_ledger_org / ix_settlements_pending (sem N+1) */
const BALANCE_SELECT = `
  SELECT o.id AS "organizationId", o.name AS "organizationName", o.commission_rate::text AS "commissionRate",
         COALESCE(l.balance, 0)::numeric(18,2)::text AS balance,
         COALESCE(l.collected, 0)::numeric(18,2)::text AS collected,
         COALESCE(l.commission, 0)::numeric(18,2)::text AS commission,
         COALESCE(l.settled, 0)::numeric(18,2)::text AS settled,
         COALESCE(s.pending_to, 0)::numeric(18,2)::text AS "pendingToCreditor",
         COALESCE(s.pending_from, 0)::numeric(18,2)::text AS "pendingFromCreditor"
    FROM organizations o
    LEFT JOIN LATERAL (
      SELECT sum(e.amount) AS balance,
             sum(e.amount) FILTER (WHERE e.kind = 'COLLECTED') AS collected,
             sum(e.amount) FILTER (WHERE e.kind = 'COMMISSION') AS commission,
             sum(e.amount) FILTER (WHERE e.kind = 'SETTLEMENT') AS settled
        FROM creditor_ledger_entries e WHERE e.organization_id = o.id
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT sum(x.amount) FILTER (WHERE x.direction = 'TO_CREDITOR') AS pending_to,
             sum(x.amount) FILTER (WHERE x.direction = 'FROM_CREDITOR') AS pending_from
        FROM creditor_settlements x WHERE x.organization_id = o.id AND x.status = 'PENDING'
    ) s ON true`;

@Injectable()
export class TypeOrmCreditorAccounts extends BaseTypeOrmRepository implements CreditorLedger, CreditorAccounts {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  // ---------------------------------------------------------------- CreditorLedger (porta pública)
  async commissionRateOf(organizationId: number): Promise<string> {
    const [r] = await this.manager.query('SELECT commission_rate::text AS rate FROM organizations WHERE id = $1', [organizationId]);
    return r?.rate ?? '0';
  }

  async record(entries: CreditorLedgerEntry[]): Promise<void> {
    if (!entries.length) return;
    await this.manager.query(
      `INSERT INTO creditor_ledger_entries (organization_id, kind, amount, payment_id, settlement_id, description)
       SELECT * FROM unnest($1::int[], $2::varchar[], $3::numeric[], $4::bigint[], $5::bigint[], $6::text[])`,
      [
        entries.map((e) => e.organizationId),
        entries.map((e) => e.kind),
        entries.map((e) => e.amount),
        entries.map((e) => e.paymentId ?? null),
        entries.map((e) => e.settlementId ?? null),
        entries.map((e) => e.description),
      ],
    );
  }

  /** inverso de cada lançamento ainda não estornado do pagamento; o índice único em reversal_of_id impede duplicar */
  async reversePayment(paymentId: string, description: string): Promise<number> {
    const [, n] = await this.manager.query(
      `INSERT INTO creditor_ledger_entries (organization_id, kind, amount, payment_id, reversal_of_id, description)
       SELECT e.organization_id, e.kind, -e.amount, e.payment_id, e.id, $2
         FROM creditor_ledger_entries e
        WHERE e.payment_id = $1 AND e.reversal_of_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM creditor_ledger_entries r WHERE r.reversal_of_id = e.id)`,
      [paymentId, description],
    );
    return n ?? 0;
  }

  // ---------------------------------------------------------------- CreditorAccounts (leitura/administração)
  async lockCreditor(organizationId: number): Promise<{ id: number; name: string } | null> {
    const [o] = await this.manager.query('SELECT id, name FROM organizations WHERE id = $1 FOR UPDATE', [organizationId]);
    return o ?? null;
  }

  async balances(criteria: Criteria<CreditorBalanceField>): Promise<Page<CreditorBalance>> {
    const c = BALANCE_FIELDS.compile(criteria);
    const rows = await this.manager.query(
      `${BALANCE_SELECT} WHERE ${c.where} ORDER BY ${c.orderBy}, o.id LIMIT $${c.params.length + 1} OFFSET $${c.params.length + 2}`,
      [...c.params, c.limit, c.offset],
    );
    const [{ total }] = await this.manager.query(`SELECT count(*)::int AS total FROM organizations o WHERE ${c.where}`, c.params);
    return buildPage(rows, total, { page: criteria.page, perPage: criteria.perPage });
  }

  async balanceOf(organizationId: number): Promise<CreditorBalance | null> {
    const [r] = await this.manager.query(`${BALANCE_SELECT} WHERE o.id = $1`, [organizationId]);
    return r ?? null;
  }

  async statement(organizationId: number, page: number, perPage: number, from?: string, to?: string): Promise<Page<LedgerLine>> {
    const rows = await this.manager.query(
      `SELECT e.id::text AS id, e.organization_id AS "organizationId", e.kind, e.amount::text AS amount,
              e.payment_id::text AS "paymentId", e.settlement_id::text AS "settlementId",
              e.reversal_of_id::text AS "reversalOfId", e.description, e.created_at AS "createdAt",
              count(*) OVER () AS total
         FROM creditor_ledger_entries e
        WHERE e.organization_id = $1
          AND ($2::date IS NULL OR e.created_at >= $2::date)
          AND ($3::date IS NULL OR e.created_at < $3::date + 1)
        ORDER BY e.created_at DESC, e.id DESC LIMIT $4 OFFSET $5`,
      [organizationId, from ?? null, to ?? null, perPage, (page - 1) * perPage],
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return buildPage(
      rows.map(({ total: _t, ...r }: { total: string }) => r),
      total,
      { page, perPage },
    );
  }

  async setCommissionRate(organizationId: number, rate: string): Promise<string | null> {
    const [rows] = await this.manager.query(
      `UPDATE organizations o SET commission_rate = $2, updated_at = now()
         FROM (SELECT commission_rate FROM organizations WHERE id = $1 FOR UPDATE) old
        WHERE o.id = $1 RETURNING old.commission_rate::text AS previous`,
      [organizationId, rate],
    );
    return rows[0]?.previous ?? null;
  }
}

const SETTLEMENT_FIELDS = new CriteriaCompiler<SettlementField>({
  organizationId: { column: 's.organization_id', type: 'number' },
  direction: { column: 's.direction', type: 'enum' },
  status: { column: 's.status', type: 'enum' },
  settledOn: { column: 's.settled_on', type: 'date' },
  amount: { column: 's.amount', type: 'decimal' },
  registeredById: { column: 's.registered_by_id', type: 'number' },
  createdAt: { column: 's.created_at', type: 'date' },
  organizationName: { column: 'o.name', searchable: true },
  reference: { column: 's.reference', searchable: true },
});

const SETTLEMENT_COLUMNS = `
  s.id::text AS id, s.organization_id AS "organizationId", o.name AS "organizationName", s.direction, s.amount::text AS amount,
  to_char(s.settled_on, 'YYYY-MM-DD') AS "settledOn", s.payment_method_id AS "paymentMethodId", pm.name AS "paymentMethodName",
  s.reference, s.proof_path AS "proofPath", s.notes, s.status, s.registered_by_id AS "registeredById",
  s.confirmed_by_id AS "confirmedById", s.confirmed_at AS "confirmedAt", s.cancelled_by_id AS "cancelledById",
  s.cancelled_at AS "cancelledAt", s.cancel_reason AS "cancelReason", s.version, s.created_at AS "createdAt"`;
const SETTLEMENT_FROM = `FROM creditor_settlements s JOIN organizations o ON o.id = s.organization_id JOIN payment_methods pm ON pm.id = s.payment_method_id`;

@Injectable()
export class TypeOrmSettlementRepository extends BaseTypeOrmRepository implements SettlementRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async paymentMethod(id: number) {
    const [m] = await this.manager.query(
      'SELECT id, name, requires_reference AS "requiresReference" FROM payment_methods WHERE id = $1 AND is_active',
      [id],
    );
    return m ?? null;
  }

  async create(s: NewSettlement): Promise<string> {
    try {
      const [r] = await this.manager.query(
        `INSERT INTO creditor_settlements (organization_id, direction, amount, settled_on, payment_method_id, reference, proof_path, notes, registered_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
        [s.organizationId, s.direction, s.amount, s.settledOn, s.paymentMethodId, s.reference, s.proofPath, s.notes, s.registeredById],
      );
      return r.id;
    } catch (e) {
      if (isUniqueViolation(e, 'ux_settlements_method_reference')) throw new ConflictError('Este comprovativo (meio + referência) já foi registado');
      throw e;
    }
  }

  async findById(id: string): Promise<Settlement | null> {
    const [r] = await this.manager.query(`SELECT ${SETTLEMENT_COLUMNS} ${SETTLEMENT_FROM} WHERE s.id = $1`, [id]);
    return r ?? null;
  }

  async findForUpdate(id: string): Promise<Settlement | null> {
    const [r] = await this.manager.query(`SELECT ${SETTLEMENT_COLUMNS} ${SETTLEMENT_FROM} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
    return r ?? null;
  }

  async markConfirmed(id: string, version: number, byUserId: number): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE creditor_settlements SET status = 'CONFIRMED', confirmed_by_id = $3, confirmed_at = now(), version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'PENDING'`,
      [id, version, byUserId],
    );
    return n > 0;
  }

  async markCancelled(id: string, version: number, byUserId: number, reason: string): Promise<boolean> {
    const [, n] = await this.manager.query(
      `UPDATE creditor_settlements SET status = 'CANCELLED', cancelled_by_id = $3, cancelled_at = now(), cancel_reason = $4,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 AND status = 'PENDING'`,
      [id, version, byUserId, reason],
    );
    return n > 0;
  }

  async search(criteria: Criteria<SettlementField>): Promise<Page<Settlement>> {
    const c = SETTLEMENT_FIELDS.compile(criteria);
    const rows = await this.manager.query(
      `SELECT ${SETTLEMENT_COLUMNS} ${SETTLEMENT_FROM} WHERE ${c.where} ORDER BY ${c.orderBy}, s.id DESC
        LIMIT $${c.params.length + 1} OFFSET $${c.params.length + 2}`,
      [...c.params, c.limit, c.offset],
    );
    const [{ total }] = await this.manager.query(`SELECT count(*)::int AS total ${SETTLEMENT_FROM} WHERE ${c.where}`, c.params);
    return buildPage(rows, total, { page: criteria.page, perPage: criteria.perPage });
  }
}
