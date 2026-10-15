import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { Money } from '@/shared/domain/money';
import { CriteriaCompiler } from '@/infrastructure/database/criteria/criteria-compiler';
import { applyCriteria } from '@/infrastructure/database/criteria/query-builder.adapter';
import { Criteria } from '@/shared/domain/criteria';
import { buildPage, offsetOf, Page, PageRequest } from '@/shared/domain/pagination';
import {
  Assignment,
  GenerationResult,
  NewTransfer,
  Process,
  ProcessCommandRepository,
  ProcessField,
  ProcessListItem,
  ProcessLock,
  ProcessLookup,
  ProcessQueries,
} from '../domain/process.repository';
import {
  ProcessAssignmentOrmEntity,
  ProcessInvoiceOrmEntity,
  ProcessOrmEntity,
} from './process.orm-entities';
import { processVisibleSql, scopeValue } from '@/infrastructure/database/visibility.sql';
import { InvoiceOrmEntity } from '@/modules/invoices/infrastructure/invoice.orm-entity';

const PROCESS_FIELDS = new CriteriaCompiler<ProcessField>({
  debtorId: { column: 'p.debtor_id', type: 'number' },
  state: { column: 'processState.code', type: 'enum' },
  assignedUserId: { column: 'assignment.user_id', type: 'number' },
  closedAt: { column: 'p.closed_at', type: 'date' },
  createdAt: { column: 'p.created_at', type: 'date' },
  startDate: { column: 'p.start_date', type: 'date' },
  debtorName: { column: 'debtor.name', searchable: true },
  debtorNif: { column: 'debtor.nif' },
  // nunca contactado conta como "há muito tempo" → aparece no filtro "sem contacto desde X"
  lastContactAt: { column: "COALESCE(p.last_contact_at, '-infinity'::timestamptz)", type: 'date' },
  lastContactStatus: { column: 'p.last_contact_status', type: 'enum' },
  contactsCount: { column: 'p.contacts_count', type: 'number' },
});


@Injectable()
export class TypeOrmProcessRepository
  extends BaseTypeOrmRepository
  implements ProcessCommandRepository, ProcessLookup, ProcessQueries
{
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  // =========================== Comandos ===========================

  /**
   * Substitui o loop do original (≈4 queries POR factura, sem transacção) por UM statement:
   *  1. selecciona facturas vencidas fora de processo (FOR UPDATE SKIP LOCKED);
   *  2. cria 1 processo aberto por devedor (ON CONFLICT no índice parcial → idempotente);
   *  3. liga as facturas ao processo aberto (ux_process_invoices_invoice → idempotente);
   *  4. marca as facturas como em processo.
   */
  async generateFromOverdueInvoices(overdueStateId: number, openProcessStateId: number): Promise<GenerationResult> {
    const [r] = await this.manager.query(
      `WITH candidates AS (
         SELECT i.id, i.debtor_id FROM invoices i
          WHERE NOT i.in_process AND i.invoice_state_id = $1
            -- tolerância da régua master: a factura só entra em cobrança N dias depois do vencimento
            AND i.due_date + COALESCE((SELECT grace_days FROM collection_policies WHERE id = 1), 0)
                < (now() AT TIME ZONE 'Africa/Luanda')::date
          FOR UPDATE SKIP LOCKED
       ), debtors_c AS (SELECT DISTINCT debtor_id FROM candidates),
       new_proc AS (
         INSERT INTO processes (debtor_id, process_state_id, start_date)
         SELECT debtor_id, $2, now() FROM debtors_c
         ON CONFLICT (debtor_id) WHERE closed_at IS NULL DO NOTHING
         RETURNING id, debtor_id
       ), target AS (
         SELECT id, debtor_id FROM new_proc
         UNION ALL
         SELECT p.id, p.debtor_id FROM processes p JOIN debtors_c d USING (debtor_id) WHERE p.closed_at IS NULL
       ), linked AS (
         INSERT INTO process_invoices (process_id, invoice_id)
         SELECT t.id, c.id FROM candidates c JOIN target t USING (debtor_id)
         ON CONFLICT (invoice_id) DO NOTHING
         RETURNING invoice_id
       ), flagged AS (
         UPDATE invoices SET in_process = true, updated_at = now()
          WHERE id IN (SELECT invoice_id FROM linked) RETURNING id
       )
       SELECT (SELECT count(*) FROM new_proc)::int AS "processesCreated",
              (SELECT count(*) FROM flagged)::int  AS "invoicesLinked"`,
      [overdueStateId, openProcessStateId],
    );
    return r;
  }

  /** Atribui ao dono da carteira os processos abertos ainda sem responsável — 1 INSERT…SELECT. */
  async assignFromWallets(): Promise<Assignment[]> {
    return this.manager.query(
      `INSERT INTO process_assignments (process_id, user_id)
       SELECT p.id, w.user_id
         FROM processes p
         JOIN user_wallets w ON w.debtor_id = p.debtor_id
         JOIN users u ON u.id = w.user_id AND u.is_active
        WHERE p.closed_at IS NULL
       ON CONFLICT (process_id) DO NOTHING
       RETURNING process_id AS "processId", user_id AS "userId"`,
    );
  }

  /**
   * Distribuição round-robin pelos agentes activos, começando pelos de menor carga.
   * Tudo em SQL (window functions) → sem carregar utilizadores/processos para memória.
   */
  async autoAssignRoundRobin(excludeRoleSlug: string): Promise<Assignment[]> {
    return this.manager.query(
      `WITH agents AS (
         SELECT u.id, (row_number() OVER (ORDER BY count(pa.id), max(pa.created_at) NULLS FIRST, u.id) - 1) AS rn
           FROM users u
           JOIN roles r ON r.id = u.role_id AND r.is_active AND NOT r.is_manager AND r.slug <> $1
           LEFT JOIN process_assignments pa ON pa.user_id = u.id
          WHERE u.is_active
          GROUP BY u.id
       ), n AS (SELECT count(*) AS c FROM agents),
       procs AS (
         SELECT p.id, (row_number() OVER (ORDER BY p.created_at, p.id) - 1) AS rn
           FROM processes p
          WHERE p.closed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM process_assignments pa WHERE pa.process_id = p.id)
       )
       INSERT INTO process_assignments (process_id, user_id)
       SELECT procs.id, agents.id
         FROM procs CROSS JOIN n
         JOIN agents ON agents.rn = procs.rn % n.c
        WHERE n.c > 0
       ON CONFLICT (process_id) DO NOTHING
       RETURNING process_id AS "processId", user_id AS "userId"`,
      [excludeRoleSlug],
    );
  }

  findOpen(processId: number): Promise<Process | null> {
    return this.repo(ProcessOrmEntity).createQueryBuilder('p').where('p.id = :processId AND p.closed_at IS NULL', { processId }).getOne();
  }

  async assign(processId: number, userId: number): Promise<boolean> {
    const rows: unknown[] = await this.manager.query(
      `INSERT INTO process_assignments (process_id, user_id) VALUES ($1, $2)
       ON CONFLICT (process_id) DO NOTHING RETURNING id`,
      [processId, userId],
    );
    return rows.length > 0;
  }

  async currentAssignee(processId: number): Promise<number | null> {
    return (await this.repo(ProcessAssignmentOrmEntity).findOneBy({ processId }))?.userId ?? null;
  }

  async lockAssignments(processIds: number[], userId: number): Promise<number[]> {
    const rows: Array<{ process_id: number }> = await this.manager.query(
      `SELECT process_id FROM process_assignments
        WHERE process_id = ANY($1) AND user_id = $2
        ORDER BY process_id
        FOR UPDATE`,
      [processIds, userId],
    );
    return rows.map((r) => r.process_id);
  }

  async reassign(processIds: number[], fromUserId: number, toUserId: number): Promise<number> {
    const [, affected] = await this.manager.query(
      `UPDATE process_assignments SET user_id = $3, updated_at = now()
        WHERE process_id = ANY($1) AND user_id = $2`,
      [processIds, fromUserId, toUserId],
    );
    return affected;
  }

  /** inserção multi-linha via unnest (1 round-trip para N transferências) */
  async insertTransfers(rows: NewTransfer[]): Promise<number[]> {
    if (!rows.length) return [];
    const res: Array<{ id: number }> = await this.manager.query(
      `INSERT INTO process_transfers (process_id, from_user_id, to_user_id, performed_by_id, reason, notes, is_permanent, return_at, status)
       SELECT * , 'COMPLETED' FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::text[], $6::text[], $7::bool[], $8::timestamptz[])
       RETURNING id`,
      [
        rows.map((r) => r.processId),
        rows.map((r) => r.fromUserId),
        rows.map((r) => r.toUserId),
        rows.map((r) => r.performedById),
        rows.map((r) => r.reason),
        rows.map((r) => r.notes),
        rows.map((r) => r.isPermanent),
        rows.map((r) => r.returnAt),
      ],
    );
    return res.map((r) => r.id);
  }

  /** Devolve ao agente de origem as transferências temporárias vencidas (funcionalidade que no original não existia). */
  async returnDueTemporaryTransfers(): Promise<Array<{ processId: number; userId: number }>> {
    const res = await this.manager.query(
      `WITH due AS (
         SELECT t.id, t.process_id, t.from_user_id, t.to_user_id
           FROM process_transfers t
          WHERE NOT t.is_permanent AND t.status = 'COMPLETED' AND t.returned_at IS NULL AND t.return_at <= now()
          ORDER BY t.process_id
          FOR UPDATE SKIP LOCKED
       ), moved AS (
         UPDATE process_assignments pa SET user_id = due.from_user_id, updated_at = now()
           FROM due
          WHERE pa.process_id = due.process_id AND pa.user_id = due.to_user_id
         RETURNING pa.process_id, pa.user_id
       ), closed AS (
         UPDATE process_transfers t SET returned_at = now(), status = 'RETURNED'
           FROM due WHERE t.id = due.id
         RETURNING t.id
       )
       SELECT m.process_id AS "processId", m.user_id AS "userId", (SELECT count(*) FROM closed) AS closed FROM moved m`,
    );
    return res;
  }

  /** DELETE + UPDATE num único statement (antes: 2 queries por factura em Promise.all, sem transacção). */
  async detachInvoicesToDispute(processId: number, invoiceIds: number[], disputeStateId: number): Promise<number[]> {
    const res = await this.manager.query(
      `WITH del AS (
         DELETE FROM process_invoices WHERE process_id = $1 AND invoice_id = ANY($2) RETURNING invoice_id
       )
       UPDATE invoices SET in_process = false, invoice_state_id = $3, updated_at = now()
        WHERE id IN (SELECT invoice_id FROM del)
       RETURNING id`,
      [processId, invoiceIds, disputeStateId],
    );
    const rows: Array<{ id: number }> = Array.isArray(res[0]) ? res[0] : res;
    return rows.map((r) => r.id);
  }

  async hasActiveNegotiation(processId: number): Promise<boolean> {
    const [r] = await this.manager.query(
      'SELECT EXISTS (SELECT 1 FROM negotiation_processes WHERE process_id = $1 AND is_active) AS e',
      [processId],
    );
    return r.e;
  }

  /** Arranque da cobrança: REGISTADO → Em cobrança (só processos abertos; idempotente). */
  async startCollection(processIds: number[], registeredStateId: number, inProgressStateId: number): Promise<number> {
    if (!processIds.length) return 0;
    const r = await this.manager.query(
      `UPDATE processes SET process_state_id = $2, updated_at = now()
        WHERE id = ANY($1::int[]) AND closed_at IS NULL AND process_state_id = $3`,
      [processIds, inProgressStateId, registeredStateId],
    );
    return Array.isArray(r) ? (r[1] ?? 0) : 0;
  }

  // =========================== ProcessLookup ===========================

  async lockForUpdate(ids: number[]): Promise<ProcessLock[]> {
    return this.manager.query(
      `SELECT id, debtor_id AS "debtorId", (closed_at IS NULL) AS "isOpen"
         FROM processes WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
      [ids],
    );
  }

  async outstandingAmount(ids: number[]): Promise<string> {
    const [r] = await this.manager.query(
      `SELECT COALESCE(sum(i.amount), 0)::numeric(18,2)::text AS total
         FROM process_invoices pi JOIN invoices i ON i.id = pi.invoice_id
        WHERE pi.process_id = ANY($1)`,
      [ids],
    );
    return r.total;
  }

  // =========================== Queries ===========================

  /**
   * Lista de processos sem N+1:
   *  - página com JOINs N:1/1:1 (devedor, estado, responsável);
   *  - facturas das N linhas numa única query IN;
   *  - agregados (contagem/total) calculados em memória a partir dessa query.
   */
  async search(criteria: Criteria<ProcessField>): Promise<Page<ProcessListItem>> {
    const req = { page: criteria.page, perPage: criteria.perPage };
    const qb = this.repo(ProcessOrmEntity)
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.debtor', 'debtor')
      .leftJoinAndSelect('p.processState', 'processState')
      .leftJoinAndSelect('p.assignment', 'assignment') // 1:1 (ux_process_assignments_process)
      .leftJoin('assignment.user', 'assignee')
      .addSelect(['assignee.id', 'assignee.fullName', 'assignee.email']);
    if (criteria.scope && criteria.scope.kind !== 'ALL') {
      qb.andWhere(processVisibleSql('p.id', criteria.scope, ':visUser'), { visUser: scopeValue(criteria.scope) });
    }
    const [rows, total] = await applyCriteria(qb, PROCESS_FIELDS, criteria, 'p.id').getManyAndCount();
    const links = rows.length
      ? await this.repo(ProcessInvoiceOrmEntity).find({
          where: { processId: In(rows.map((r) => r.id)) },
          relations: { invoice: { currency: true, invoiceState: true } },
        })
      : [];
    const byProcess = new Map<number, InvoiceOrmEntity[]>();
    links.forEach((l) => l.invoice && byProcess.set(l.processId, [...(byProcess.get(l.processId) ?? []), l.invoice]));
    // processos já presos a um acordo activo: o ecrã mostra-os bloqueados em vez de falhar ao gravar
    const busy: Array<{ process_id: number }> = rows.length
      ? await this.manager.query('SELECT process_id FROM negotiation_processes WHERE is_active AND process_id = ANY($1)', [rows.map((r) => r.id)])
      : [];
    const inNegotiation = new Set(busy.map((b) => Number(b.process_id)));
    const data = rows.map((p) => {
      const invoices = byProcess.get(p.id) ?? [];
      const totalAmount = Money.sum(invoices.map((i) => i.amount)).toString();
      return Object.assign(p, { invoices, invoicesCount: invoices.length, totalAmount, inNegotiation: inNegotiation.has(p.id) });
    });
    return buildPage(data, total, req);
  }

  async paginateAssignedTo(userId: number, req: PageRequest): Promise<Page<ProcessAssignmentOrmEntity>> {
    const [rows, total] = await this.repo(ProcessAssignmentOrmEntity).findAndCount({
      where: { userId },
      relations: { process: { debtor: true, processState: true }, user: true },
      order: { createdAt: 'DESC' },
      skip: offsetOf(req),
      take: req.perPage,
    });
    return buildPage(rows, total, req);
  }

  async paginateInvoicesOf(processId: number, req: PageRequest): Promise<Page<ProcessInvoiceOrmEntity>> {
    const [rows, total] = await this.repo(ProcessInvoiceOrmEntity).findAndCount({
      where: { processId },
      relations: { invoice: { currency: true, debtor: true, createdBy: true, invoiceState: true } },
      order: { createdAt: 'DESC' },
      skip: offsetOf(req),
      take: req.perPage,
    });
    return buildPage(rows, total, req);
  }
}
