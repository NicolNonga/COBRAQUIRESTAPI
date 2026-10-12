import { Injectable } from '@nestjs/common';
import { UserRepository } from '@/modules/users/domain/user.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ConflictError, NotFoundError } from '@/shared/domain/errors';
import { WalletRepository } from '../domain/wallet.repository';

@Injectable()
export class AddDebtorToWalletUseCase {
  constructor(private readonly wallets: WalletRepository, private readonly users: UserRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(userId: number, debtorId: number) {
    return this.uow.run(async () => {
      const u = await this.users.findAuthSnapshot(userId);
      if (!u?.isActive) throw new NotFoundError('Agente não encontrado ou inactivo');
      if (!(await this.wallets.add(userId, debtorId))) {
        const owner = await this.wallets.ownerOf(debtorId);
        throw new ConflictError(owner === userId ? 'Devedor já está nesta carteira' : 'Devedor já pertence à carteira de outro agente; use a transferência');
      }
      await this.audit.record({ action: 'WALLET_DEBTOR_ADDED', entity: 'user_wallet', entityId: debtorId, payload: { userId } });
    });
  }
}

@Injectable()
export class RemoveDebtorsFromWalletUseCase {
  constructor(private readonly wallets: WalletRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(debtorIds: number[]) {
    return this.uow.run(async () => {
      const n = await this.wallets.remove([...new Set(debtorIds)]); // 1 DELETE … ANY($1)
      if (!n) throw new NotFoundError('Nenhum dos devedores está numa carteira');
      await this.audit.record({ action: 'WALLET_DEBTORS_REMOVED', entity: 'user_wallet', payload: { debtorIds, removed: n } });
      return n;
    });
  }
}

@Injectable()
export class TransferDebtorsUseCase {
  constructor(private readonly wallets: WalletRepository, private readonly users: UserRepository, private readonly uow: UnitOfWork, private readonly audit: AuditTrail) {}

  execute(toUserId: number, debtorIds: number[]) {
    return this.uow.run(async () => {
      const u = await this.users.findAuthSnapshot(toUserId);
      if (!u?.isActive) throw new NotFoundError('Agente de destino não encontrado ou inactivo');
      const moved = await this.wallets.moveTo(toUserId, [...new Set(debtorIds)]);
      await this.audit.record({ action: 'WALLET_DEBTORS_TRANSFERRED', entity: 'user_wallet', payload: { toUserId, moved } });
      return moved.length;
    });
  }
}

@Injectable()
export class ListWalletDebtorsUseCase {
  constructor(private readonly wallets: WalletRepository) {}
  execute(userId: number) {
    return this.wallets.debtorsOf(userId);
  }
}
