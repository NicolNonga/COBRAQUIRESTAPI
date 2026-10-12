import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { FileStorage } from '@/shared/application/file-storage.port';
import { Criteria, CriteriaBuilder, FilterOperator, Sort } from '@/shared/domain/criteria';
import { NotFoundError } from '@/shared/domain/errors';
import { PaymentReceiver, PaymentStatus } from '../domain/payment';
import { DebtorCreditRepository, PaymentField, PaymentRepository } from '../domain/payment.repository';
import { PaymentAuthority } from './payment-authority';

export interface PaymentSearch {
  page: number;
  perPage: number;
  search?: string;
  sort?: Sort<PaymentField>[];
  statuses?: PaymentStatus[];
  receiver?: PaymentReceiver;
  negotiationId?: number;
  installmentId?: number;
  debtorId?: number;
  organizationId?: number;
  registeredById?: number;
  paymentMethodId?: number;
  currencyId?: number;
  paidFrom?: string;
  paidTo?: string;
  minAmount?: string;
  maxAmount?: string;
}

@Injectable()
export class PaymentQueriesUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly credit: DebtorCreditRepository,
    private readonly storage: FileStorage,
    private readonly authority: PaymentAuthority,
  ) {}

  list(f: PaymentSearch, extra?: (c: CriteriaBuilder<PaymentField>) => void) {
    const c = Criteria.for<PaymentField>()
      .add('status', f.statuses, FilterOperator.IN)
      .add('receiver', f.receiver)
      .add('negotiationId', f.negotiationId)
      .add('installmentId', f.installmentId)
      .add('debtorId', f.debtorId)
      .add('organizationId', f.organizationId)
      .add('registeredById', f.registeredById)
      .add('paymentMethodId', f.paymentMethodId)
      .add('currencyId', f.currencyId)
      .add('paidOn', f.paidFrom, FilterOperator.GREATER_OR_EQUAL)
      .add('paidOn', f.paidTo, FilterOperator.LESS_OR_EQUAL)
      .add('amountBase', f.minAmount, FilterOperator.GREATER_OR_EQUAL)
      .add('amountBase', f.maxAmount, FilterOperator.LESS_OR_EQUAL)
      .anyOf(['debtorName', 'reference'], f.search);
    extra?.(c);
    return this.payments.search(c.orderBy(f.sort, { field: 'createdAt', direction: 'DESC' }).paginate(f.page, f.perPage).build());
  }

  /**
   * Fila de confirmação: pendentes mais antigos primeiro.
   * Financeiro (permissão) vê todos; gestor vê os da sua carteira; nunca os registados por si.
   */
  pendingQueue(me: AuthenticatedUser, f: PaymentSearch) {
    const all = this.authority.canSeeAllQueue(me);
    return this.list({ ...f, statuses: ['PENDING'], sort: f.sort ?? [{ field: 'createdAt', direction: 'ASC' }] }, (c) => {
      c.add('registeredById', me.id, FilterOperator.NOT_EQUAL);
      if (!all) c.add('registrantManagerId', me.id);
    });
  }

  async byId(id: string) {
    const p = await this.payments.findById(id);
    if (!p) throw new NotFoundError('Pagamento não encontrado');
    return { ...p, allocations: await this.payments.allocationsOf(id) };
  }

  async proofPath(id: string): Promise<string> {
    const p = await this.payments.findById(id);
    if (!p) throw new NotFoundError('Pagamento não encontrado');
    if (!(await this.storage.exists(p.proofPath))) throw new NotFoundError('Comprovativo não encontrado no armazenamento');
    return this.storage.absolutePath(p.proofPath);
  }

  async debtorCredit(debtorId: number, page: number, perPage: number) {
    const [balance, entries] = await Promise.all([this.credit.balanceOf(debtorId), this.credit.statement(debtorId, page, perPage)]);
    return { debtorId, balance, ...entries };
  }
}
