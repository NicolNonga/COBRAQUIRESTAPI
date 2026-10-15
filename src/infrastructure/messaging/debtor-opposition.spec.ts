import { ConfigService } from '@nestjs/config';
import { ConflictError } from '@/shared/domain/errors';
import { ContactRestrictions, MessageChannel } from '@/shared/application/contact-restrictions.port';
import { maskEmail, maskPhone } from '@/shared/application/mask-pii';
import { AddContactRestrictionUseCase } from '@/modules/debtors/application/contact-restriction.use-cases';
import { DebtorEmailHandler, DebtorSmsHandler } from './debtor-messages.handlers';

const restrictions = (blocked: MessageChannel[], addResult: number | null = 1) =>
  ({ blocked: async (ids: number[]) => new Map(blocked.length ? ids.map((i) => [i, new Set(blocked)]) : []), add: async () => addResult }) as unknown as ContactRestrictions;
const env = (m: 'send' | 'log') => ({ get: (_k: string, d?: string) => m ?? d }) as unknown as ConfigService;
const msg = { payload: { debtorId: 3, debtorName: 'Ana', processId: 9, stepId: 1, to: 'ana@exemplo.ao', text: 'Aviso' } } as never;

describe('Oposição do devedor (Lei 22/11, art. 27.º)', () => {
  it('mascara email e telefone', () => {
    expect(maskEmail('ana.silva@exemplo.ao')).toBe('a***@exemplo.ao');
    expect(maskPhone('+244 923 456 789')).toBe('+244***89');
    expect(maskEmail(null)).toBe('—');
  });

  it('email: com oposição, não envia', async () => {
    const sent: unknown[] = [];
    const h = new DebtorEmailHandler({ send: async (x: unknown) => void sent.push(x) } as never, env('send'), restrictions(['EMAIL']));
    await h.handle(msg);
    expect(sent).toHaveLength(0);
  });
  it('email: sem oposição, envia; oposição só a SMS não bloqueia email', async () => {
    const sent: unknown[] = [];
    const h = new DebtorEmailHandler({ send: async (x: unknown) => void sent.push(x) } as never, env('send'), restrictions(['SMS']));
    await h.handle(msg);
    expect(sent).toHaveLength(1);
  });
  it('SMS: com oposição, termina sem erro (mensagem suprimida, não repetida)', async () => {
    const h = new DebtorSmsHandler(restrictions(['SMS']));
    await expect(h.handle({ payload: { ...(msg as any).payload, to: '+244923000000' } } as never)).resolves.toBeUndefined();
  });

  it('registar duas vezes a mesma oposição → conflito', async () => {
    const uc = new AddContactRestrictionUseCase({ findById: async () => ({ id: 3 }) } as never, restrictions([], null), { run: (w: () => Promise<unknown>) => w() } as never, { record: async () => undefined } as never);
    await expect(uc.execute(1, 3, { channel: 'EMAIL', source: 'DEBTOR_REQUEST', reason: 'pediu por telefone' })).rejects.toBeInstanceOf(ConflictError);
  });
});
