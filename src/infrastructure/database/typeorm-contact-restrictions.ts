import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ContactRestriction, ContactRestrictions, MessageChannel, RestrictionSource } from '@/shared/application/contact-restrictions.port';
import { txStorage } from './transaction-context';

@Injectable()
export class TypeOrmContactRestrictions extends ContactRestrictions {
  constructor(@InjectDataSource() private readonly ds: DataSource) {
    super();
  }
  private get db() {
    return txStorage.getStore()?.manager ?? this.ds;
  }

  async blocked(debtorIds: number[]): Promise<Map<number, Set<MessageChannel>>> {
    const out = new Map<number, Set<MessageChannel>>();
    const ids = [...new Set(debtorIds)];
    if (!ids.length) return out;
    const rows: Array<{ debtor_id: number; channel: string }> = await this.db.query(
      'SELECT debtor_id, channel FROM debtor_contact_restrictions WHERE lifted_at IS NULL AND debtor_id = ANY($1::int[])',
      [ids],
    );
    for (const r of rows) {
      const set = out.get(r.debtor_id) ?? new Set<MessageChannel>();
      if (r.channel === 'ALL') (set.add('EMAIL'), set.add('SMS'));
      else set.add(r.channel as MessageChannel);
      out.set(r.debtor_id, set);
    }
    return out;
  }

  async history(debtorId: number): Promise<ContactRestriction[]> {
    const rows: Array<Record<string, any>> = await this.db.query('SELECT * FROM debtor_contact_restrictions WHERE debtor_id = $1 ORDER BY created_at DESC, id DESC', [debtorId]);
    return rows.map((r) => ({
      id: r.id, debtorId: r.debtor_id, channel: r.channel, source: r.source, reason: r.reason, createdById: r.created_by_id,
      createdAt: r.created_at, liftedAt: r.lifted_at, liftedById: r.lifted_by_id, liftReason: r.lift_reason,
    }));
  }

  async add(i: { debtorId: number; channel: MessageChannel | 'ALL'; source: RestrictionSource; reason: string; userId: number }): Promise<number | null> {
    const rows: Array<{ id: number }> = await this.db.query(
      `INSERT INTO debtor_contact_restrictions (debtor_id, channel, source, reason, created_by_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (debtor_id, channel) WHERE lifted_at IS NULL DO NOTHING RETURNING id`,
      [i.debtorId, i.channel, i.source, i.reason, i.userId],
    );
    return rows[0]?.id ?? null;
  }

  async lift(id: number, debtorId: number, userId: number, reason: string): Promise<boolean> {
    const res: unknown = await this.db.query(
      'UPDATE debtor_contact_restrictions SET lifted_at = now(), lifted_by_id = $3, lift_reason = $4 WHERE id = $1 AND debtor_id = $2 AND lifted_at IS NULL RETURNING id',
      [id, debtorId, userId, reason],
    );
    // o TypeORM devolve [linhas, nº afectadas] em UPDATE ... RETURNING; noutras versões só as linhas
    const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res as unknown[]);
    return rows.length > 0;
  }
}
