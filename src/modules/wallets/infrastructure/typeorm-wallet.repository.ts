import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DebtorOrmEntity } from '@/modules/debtors/infrastructure/debtor.orm-entities';
import { BaseTypeOrmRepository } from '@/infrastructure/database/base.repository';
import { WalletRepository } from '../domain/wallet.repository';
import { UserWalletOrmEntity } from './user-wallet.orm-entity';

@Injectable()
export class TypeOrmWalletRepository extends BaseTypeOrmRepository implements WalletRepository {
  constructor(@InjectDataSource() ds: DataSource) {
    super(ds);
  }

  async add(userId: number, debtorId: number): Promise<boolean> {
    const rows: unknown[] = await this.manager.query(
      `INSERT INTO user_wallets (user_id, debtor_id) VALUES ($1, $2)
       ON CONFLICT (debtor_id) DO NOTHING RETURNING id`,
      [userId, debtorId],
    );
    return rows.length > 0;
  }

  async ownerOf(debtorId: number): Promise<number | null> {
    return (await this.repo(UserWalletOrmEntity).findOneBy({ debtorId }))?.userId ?? null;
  }

  async remove(debtorIds: number[]): Promise<number> {
    const [, n] = await this.manager.query('DELETE FROM user_wallets WHERE debtor_id = ANY($1)', [debtorIds]);
    return n;
  }

  /**
   * Upsert atómico: substitui o "SELECT; DELETE; INSERT" por linha do original
   * (3 queries por devedor, sem transacção — uma falha a meio deixava o devedor sem carteira).
   */
  async moveTo(userId: number, debtorIds: number[]) {
    // `prev` MATERIALIZED (snapshot antes do upsert). O ON CONFLICT DO UPDATE já bloqueia as linhas.
    return this.manager.query(
      `WITH prev AS MATERIALIZED (
         SELECT debtor_id, user_id FROM user_wallets WHERE debtor_id = ANY($2)
       ), up AS (
         INSERT INTO user_wallets (user_id, debtor_id)
         SELECT $1, d FROM unnest($2::int[]) AS d
         ON CONFLICT (debtor_id) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now()
           WHERE user_wallets.user_id <> EXCLUDED.user_id
         RETURNING debtor_id
       )
       SELECT up.debtor_id AS "debtorId", prev.user_id AS "previousUserId"
         FROM up LEFT JOIN prev USING (debtor_id)`,
      [userId, debtorIds],
    );
  }

  debtorsOf(userId: number): Promise<DebtorOrmEntity[]> {
    return this.repo(DebtorOrmEntity)
      .createQueryBuilder('d')
      .innerJoin(UserWalletOrmEntity, 'w', 'w.debtor_id = d.id AND w.user_id = :userId', { userId })
      .leftJoinAndSelect('d.contactPerson', 'contactPerson')
      .leftJoinAndSelect('d.organization', 'organization')
      .leftJoinAndSelect('d.debtorType', 'debtorType')
      .orderBy('w.created_at', 'DESC')
      .getMany();
  }
}
