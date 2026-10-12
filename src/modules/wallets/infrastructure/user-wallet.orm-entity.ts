import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DebtorOrmEntity } from '@/modules/debtors/infrastructure/debtor.orm-entities';

/** Carteira: cada devedor pertence a no máximo UM agente (ux_user_wallets_debtor). */
@Entity('user_wallets')
export class UserWalletOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() debtorId: number;
  @Column() userId: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => DebtorOrmEntity) @JoinColumn({ name: 'debtor_id' }) debtor?: DebtorOrmEntity;
}
