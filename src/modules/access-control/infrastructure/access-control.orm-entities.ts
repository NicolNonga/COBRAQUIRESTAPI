import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('permissions')
export class PermissionOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) slug: string;
  @Column({ length: 120 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('roles')
export class RoleOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) slug: string;
  @Column({ length: 120 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ default: true }) isActive: boolean;
  @Column({ default: false }) isManager: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToMany(() => PermissionOrmEntity)
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions?: PermissionOrmEntity[];
}
