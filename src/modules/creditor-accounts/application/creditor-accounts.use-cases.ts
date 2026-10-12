import { Injectable } from '@nestjs/common';
import { luandaToday } from '@/modules/negotiations/application/negotiation-lifecycle.use-cases';
import { NotificationPublisher } from '@/modules/notifications/domain/notification-publisher.port';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { Clock } from '@/shared/application/clock.port';
import { FileStorage, UploadedBinary } from '@/shared/application/file-storage.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { Criteria, FilterOperator, Sort } from '@/shared/domain/criteria';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { CreditorAccounts, CreditorBalanceField, CreditorLedger } from '../domain/creditor-ledger.port';
import { SettlementDirection, SettlementField, SettlementPolicy, SettlementRepository, SettlementStatus } from '../domain/settlement';

export const CREDITOR_SETTLEMENT_PERMISSION = 'creditor_settlement_permission';
export const CREDITOR_COMMISSION_MANAGE_PERMISSION = 'creditor_commission_manage_permission';

@Injectable()
export class CreditorAccountQueriesUseCase {
  constructor(private readonly accounts: CreditorAccounts, private readonly settlements: SettlementRepository) {}

  balances(f: { page: number; perPage: number; search?: string; organizationId?: number; sort?: Sort<CreditorBalanceField>[] }) {
    return this.accounts.balances(
      Criteria.for<CreditorBalanceField>()
        .add('organizationId', f.organizationId)
        .anyOf(['organizationName'], f.search)
        .orderBy(f.sort, { field: 'organizationName', direction: 'ASC' })
        .paginate(f.page, f.perPage)
        .build(),
    );
  }

  async account(organizationId: number, page: number, perPage: number, from?: string, to?: string) {
    const balance = await this.accounts.balanceOf(organizationId);
    if (!balance) throw new NotFoundError('Credor não encontrado');
    return { ...balance, entries: await this.accounts.statement(organizationId, page, perPage, from, to) };
  }

  listSettlements(f: {
    page: number;
    perPage: number;
    search?: string;
    sort?: Sort<SettlementField>[];
    organizationId?: number;
    direction?: SettlementDirection;
    statuses?: SettlementStatus[];
    settledFrom?: string;
    settledTo?: string;
  }) {
    return this.settlements.search(
      Criteria.for<SettlementField>()
        .add('organizationId', f.organizationId)
        .add('direction', f.direction)
        .add('status', f.statuses, FilterOperator.IN)
        .add('settledOn', f.settledFrom, FilterOperator.GREATER_OR_EQUAL)
        .add('settledOn', f.settledTo, FilterOperator.LESS_OR_EQUAL)
        .anyOf(['organizationName', 'reference'], f.search)
        .orderBy(f.sort, { field: 'createdAt', direction: 'DESC' })
        .paginate(f.page, f.perPage)
        .build(),
    );
  }

  async settlement(id: string) {
    const s = await this.settlements.findById(id);
    if (!s) throw new NotFoundError('Acerto não encontrado');
    return s;
  }
}

/** Taxa de comissão por credor. Só afecta pagamentos confirmados DEPOIS da alteração (snapshot no pagamento). */
@Injectable()
export class SetCommissionRateUseCase {
  constructor(private readonly accounts: CreditorAccounts, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(organizationId: number, rate: string): Promise<void> {
    const r = Money.of(rate);
    if (r.isNegative() || r.gt(100)) throw new ValidationError('A taxa de comissão deve estar entre 0 e 100');
    return this.uow.run(async () => {
      const previous = await this.accounts.setCommissionRate(organizationId, r.toString());
      if (previous === null) throw new NotFoundError('Credor não encontrado');
      await this.audit.record({ action: 'CREDITOR_COMMISSION_RATE_CHANGED', entity: 'organization', entityId: organizationId, payload: { before: { commissionRate: previous }, after: { commissionRate: r.toString() } } });
    });
  }
}

export interface RegisterSettlementInput {
  organizationId: number;
  direction: SettlementDirection;
  amount: string;
  settledOn: string;
  paymentMethodId: number;
  reference?: string | null;
  notes?: string | null;
  proof: UploadedBinary;
}

/**
 * Financeiro regista um acerto com o credor (repasse ou recebimento de comissão) com comprovativo.
 * Fica PENDING até outro utilizador confirmar. O valor não pode exceder o disponível
 * (saldo − acertos pendentes na mesma direcção), calculado com o credor bloqueado (FOR UPDATE).
 */
@Injectable()
export class RegisterSettlementUseCase {
  constructor(
    private readonly accounts: CreditorAccounts,
    private readonly settlements: SettlementRepository,
    private readonly storage: FileStorage,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(input: RegisterSettlementInput, userId: number): Promise<{ id: string }> {
    if (input.settledOn > luandaToday(this.clock)) throw new BusinessRuleError('A data do acerto não pode ser futura');
    const method = await this.settlements.paymentMethod(input.paymentMethodId);
    if (!method) throw new ValidationError('Meio de pagamento inexistente ou inactivo');
    const reference = input.reference?.trim() || null;
    if (method.requiresReference && !reference) throw new ValidationError(`O meio "${method.name}" exige a referência do comprovativo`);
    const amount = Money.of(input.amount).toString();

    const proofPath = await this.storage.save(input.proof, 'creditor-settlements');
    try {
      return await this.uow.run(async () => {
        if (!(await this.accounts.lockCreditor(input.organizationId))) throw new NotFoundError('Credor não encontrado');
        const bal = await this.accounts.balanceOf(input.organizationId);
        const pending = input.direction === 'TO_CREDITOR' ? bal!.pendingToCreditor : bal!.pendingFromCreditor;
        SettlementPolicy.assertWithinAvailable(input.direction, amount, SettlementPolicy.available(input.direction, bal!.balance, pending));

        const id = await this.settlements.create({
          organizationId: input.organizationId,
          direction: input.direction,
          amount,
          settledOn: input.settledOn,
          paymentMethodId: method.id,
          reference,
          proofPath,
          notes: input.notes?.trim() || null,
          registeredById: userId,
        });
        await this.audit.record({ action: 'CREDITOR_SETTLEMENT_REGISTERED', entity: 'creditor_settlement', entityId: id, payload: { ...input, proof: undefined, amount, reference } });
        return { id };
      });
    } catch (e) {
      await this.storage.remove(proofPath).catch(() => undefined);
      throw e;
    }
  }
}

/** Confirmação a quatro olhos: entra na conta-corrente. O saldo é revalidado com o credor bloqueado. */
@Injectable()
export class ConfirmSettlementUseCase {
  constructor(
    private readonly accounts: CreditorAccounts,
    private readonly ledger: CreditorLedger,
    private readonly settlements: SettlementRepository,
    private readonly notifications: NotificationPublisher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(me: AuthenticatedUser, id: string): Promise<{ balance: string }> {
    return this.uow.run(async () => {
      const head = await this.settlements.findById(id);
      if (!head) throw new NotFoundError('Acerto não encontrado');
      await this.accounts.lockCreditor(head.organizationId); // ordem de locks: credor → acerto
      const s = await this.settlements.findForUpdate(id);
      if (!s) throw new NotFoundError('Acerto não encontrado');
      if (s.status !== 'PENDING') throw new ConflictError(`O acerto está ${s.status}`);
      if (s.registeredById === me.id) throw new ForbiddenError('Quem registou o acerto não o pode confirmar (quatro olhos)');

      const bal = await this.accounts.balanceOf(s.organizationId);
      SettlementPolicy.assertWithinAvailable(s.direction, s.amount, SettlementPolicy.available(s.direction, bal!.balance, '0'));

      if (!(await this.settlements.markConfirmed(id, s.version, me.id))) throw new ConflictError('O acerto foi alterado em simultâneo');
      await this.ledger.record([
        {
          organizationId: s.organizationId,
          kind: 'SETTLEMENT',
          amount: SettlementPolicy.ledgerAmount(s.direction, s.amount),
          settlementId: id,
          description: s.direction === 'TO_CREDITOR' ? `Repasse ao credor #${id}` : `Comissão recebida do credor #${id}`,
        },
      ]);
      const after = (await this.accounts.balanceOf(s.organizationId))!.balance;
      await this.notifications.publish({
        userId: s.registeredById,
        type: 'creditor_settlement.confirmed',
        title: 'Acerto com credor confirmado',
        message: `${s.direction === 'TO_CREDITOR' ? 'Repasse' : 'Recebimento de comissão'} #${id} (${s.amount}) a ${s.organizationName ?? `credor #${s.organizationId}`} confirmado.`,
        data: { settlementId: id, organizationId: s.organizationId },
        priority: 'medium',
      });
      await this.audit.record({ action: 'CREDITOR_SETTLEMENT_CONFIRMED', entity: 'creditor_settlement', entityId: id, payload: { amount: s.amount, direction: s.direction, balanceAfter: after } });
      return { balance: after };
    });
  }
}

@Injectable()
export class CancelSettlementUseCase {
  constructor(private readonly settlements: SettlementRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(me: AuthenticatedUser, id: string, reason: string): Promise<void> {
    return this.uow.run(async () => {
      const s = await this.settlements.findForUpdate(id);
      if (!s) throw new NotFoundError('Acerto não encontrado');
      if (s.status !== 'PENDING') throw new ConflictError(`Só acertos pendentes podem ser anulados (estado: ${s.status})`);
      if (!(await this.settlements.markCancelled(id, s.version, me.id, reason))) throw new ConflictError('O acerto foi alterado em simultâneo');
      await this.audit.record({ action: 'CREDITOR_SETTLEMENT_CANCELLED', entity: 'creditor_settlement', entityId: id, payload: { reason } });
    });
  }
}
