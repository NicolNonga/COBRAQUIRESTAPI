import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RoleOrmEntity } from '@/modules/access-control/infrastructure/access-control.orm-entities';
import { OrganizationOrmEntity } from '@/modules/organizations/infrastructure/organization.orm-entity';
import { CategoryOrmEntity } from '@/modules/catalogs/infrastructure/catalog.orm-entities';

@Entity('users')
export class UserOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 200, nullable: true }) fullName: string | null;
  @Column({ length: 254 }) email: string;
  @Column({ select: false }) passwordHash: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) phoneNumber: string | null;
  @Column({ type: 'int', nullable: true }) roleId: number | null;
  @Column({ type: 'int', nullable: true }) organizationId: number | null;
  @Column({ type: 'int', nullable: true }) categoryId: number | null;
  @Column({ default: true }) isActive: boolean;
  @Column({ default: true }) firstAccess: boolean;
  /** incrementado em logout/troca de palavra-passe → invalida JWTs anteriores */
  @Column({ default: 0 }) tokenVersion: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => RoleOrmEntity, { nullable: true }) @JoinColumn({ name: 'role_id' }) role?: RoleOrmEntity | null;
  @ManyToOne(() => OrganizationOrmEntity, { nullable: true }) @JoinColumn({ name: 'organization_id' }) organization?: OrganizationOrmEntity | null;
  @ManyToOne(() => CategoryOrmEntity, { nullable: true }) @JoinColumn({ name: 'category_id' }) category?: CategoryOrmEntity | null;
}

/** Relação gestor → agente (antiga tabela wallet_agents). */
@Entity('wallet_agents')
export class WalletAgentOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() agentId: number;
  @Column() managerId: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;

  @ManyToOne(() => UserOrmEntity) @JoinColumn({ name: 'agent_id' }) agent?: UserOrmEntity;
}
