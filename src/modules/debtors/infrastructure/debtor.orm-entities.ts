import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DebtorTypeOrmEntity } from '@/modules/catalogs/infrastructure/catalog.orm-entities';
import { OrganizationOrmEntity } from '@/modules/organizations/infrastructure/organization.orm-entity';

@Entity('debtors')
export class DebtorOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 200 }) name: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) nif: string | null;
  @Column({ length: 254 }) email: string;
  @Column({ length: 30 }) phoneNumber: string;
  @Column({ type: 'text' }) address: string;
  @Column({ type: 'text', nullable: true }) logoPath: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) socialReason: string | null;
  @Column({ default: true }) isCompany: boolean;
  @Column({ default: true }) isActive: boolean;
  @Column() organizationId: number;
  @Column() debtorTypeId: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => OrganizationOrmEntity) @JoinColumn({ name: 'organization_id' }) organization?: OrganizationOrmEntity;
  @ManyToOne(() => DebtorTypeOrmEntity) @JoinColumn({ name: 'debtor_type_id' }) debtorType?: DebtorTypeOrmEntity;
  @OneToOne(() => DebtorContactPersonOrmEntity, (c) => c.debtor) contactPerson?: DebtorContactPersonOrmEntity | null;
}

@Entity('debtor_contact_persons')
export class DebtorContactPersonOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() debtorId: number;
  @Column({ length: 150 }) name: string;
  @Column({ length: 254 }) email: string;
  @Column({ length: 50 }) contact: string;
  @Column({ length: 80 }) position: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @OneToOne(() => DebtorOrmEntity, (d) => d.contactPerson) @JoinColumn({ name: 'debtor_id' }) debtor?: DebtorOrmEntity;
}
