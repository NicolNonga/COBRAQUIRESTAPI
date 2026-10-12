import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('organizations')
export class OrganizationOrmEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 200 }) name: string;
  @Column({ length: 254 }) email: string;
  @Column({ length: 30 }) phoneNumber: string;
  @Column({ type: 'text' }) address: string;
  @Column({ type: 'text', nullable: true }) logoPath: string | null;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
