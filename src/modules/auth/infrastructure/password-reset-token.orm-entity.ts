import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('password_reset_tokens')
export class PasswordResetTokenOrmEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ length: 254 }) email: string;
  /** guardamos apenas o SHA-256 do token: um dump da BD não permite reset de palavras-passe */
  @Column({ length: 64 }) tokenHash: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) usedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
