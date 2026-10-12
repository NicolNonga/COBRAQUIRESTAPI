import { Injectable } from '@nestjs/common';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { ForbiddenError } from '@/shared/domain/errors';

export const PAYMENT_CONFIRM_PERMISSION = 'payment_confirm_permission';
export const PAYMENT_METHOD_MANAGE_PERMISSION = 'payment_method_manage_permission';

/**
 * Quem decide sobre um pagamento pendente (confirmar ou anular):
 *  - o financeiro (permissão `payment_confirm_permission`), ou
 *  - o gestor da carteira de quem o registou;
 *  - nunca quem o registou (quatro olhos — também garantido por CHECK na BD).
 */
@Injectable()
export class PaymentAuthority {
  constructor(private readonly users: UserRepository) {}

  async assertCanDecide(me: AuthenticatedUser, registeredById: number, action: 'confirmar' | 'anular' | 'estornar'): Promise<void> {
    if (registeredById === me.id) throw new ForbiddenError(`Quem registou o pagamento não o pode ${action} (quatro olhos)`);
    if (me.permissions.includes(PAYMENT_CONFIRM_PERMISSION)) return;
    if (me.isManager && (await this.users.managerOf(registeredById)) === me.id) return;
    throw new ForbiddenError(`Sem autorização para ${action} este pagamento`);
  }

  canSeeAllQueue(me: AuthenticatedUser): boolean {
    return me.permissions.includes(PAYMENT_CONFIRM_PERMISSION);
  }
}
