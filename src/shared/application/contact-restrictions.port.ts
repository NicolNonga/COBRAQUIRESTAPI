export type MessageChannel = 'EMAIL' | 'SMS';
export const RESTRICTION_SOURCES = ['DEBTOR_REQUEST', 'COMPLAINT', 'LEGAL', 'OTHER'] as const;
export type RestrictionSource = (typeof RESTRICTION_SOURCES)[number];

export interface ContactRestriction {
  id: number;
  debtorId: number;
  channel: MessageChannel | 'ALL';
  source: RestrictionSource;
  reason: string;
  createdById: number | null;
  createdAt: Date;
  liftedAt: Date | null;
  liftedById: number | null;
  liftReason: string | null;
}

/** Lista de "não contactar" (Lei 22/11, art. 27.º). Consultada na régua e outra vez no envio. */
export abstract class ContactRestrictions {
  /** canais bloqueados por devedor (só os que têm restrição activa; "ALL" expande para EMAIL e SMS) */
  abstract blocked(debtorIds: number[]): Promise<Map<number, Set<MessageChannel>>>;
  abstract history(debtorId: number): Promise<ContactRestriction[]>;
  /** devolve null se já existia restrição activa para esse canal */
  abstract add(input: { debtorId: number; channel: MessageChannel | 'ALL'; source: RestrictionSource; reason: string; userId: number }): Promise<number | null>;
  abstract lift(id: number, debtorId: number, userId: number, reason: string): Promise<boolean>;
}
