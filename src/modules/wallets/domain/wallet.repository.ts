import { DebtorOrmEntity } from '@/modules/debtors/infrastructure/debtor.orm-entities';

export abstract class WalletRepository {
  /** false se o devedor já estiver numa carteira */
  abstract add(userId: number, debtorId: number): Promise<boolean>;
  abstract ownerOf(debtorId: number): Promise<number | null>;
  /** remove os devedores de qualquer carteira; devolve quantos foram removidos */
  abstract remove(debtorIds: number[]): Promise<number>;
  /** move (upsert) os devedores para a carteira do utilizador; devolve os que mudaram de dono */
  abstract moveTo(userId: number, debtorIds: number[]): Promise<Array<{ debtorId: number; previousUserId: number | null }>>;
  abstract debtorsOf(userId: number): Promise<DebtorOrmEntity[]>;
}
