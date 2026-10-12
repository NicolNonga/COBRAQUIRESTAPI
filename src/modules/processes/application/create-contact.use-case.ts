import { Injectable } from '@nestjs/common';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { Clock } from '@/shared/application/clock.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, NotFoundError } from '@/shared/domain/errors';
import { PolicyRepository } from '@/modules/collection-policies/domain/policy.repository';
import { ProcessStateCode, StateCatalog } from '@/modules/catalogs/domain/state-catalog.port';
import { ContactRepository, ProcessCommandRepository } from '../domain/process.repository';
import { ContactStatus } from '../infrastructure/process.orm-entities';

export interface CreateContactInput {
  processe_id: number;
  contact_type_id: number;
  status?: ContactStatus;
  notes?: string;
  duration?: number;
  contacted_at?: string; // ISO; por omissão = agora
  contact_date?: string; // compatibilidade com o frontend antigo (YYYY-MM-DD)
  userId: number;
}

/** Margem para relógios ligeiramente adiantados no cliente. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Contactos podem ser registados com atraso, mas não indefinidamente. */
const MAX_BACKDATE_DAYS = 30;

/**
 * Regista UM contacto no histórico do processo (N por processo, append-only)
 * e actualiza o resumo do processo na MESMA transacção.
 */
@Injectable()
export class CreateContactUseCase {
  constructor(
    private readonly contacts: ContactRepository,
    private readonly processes: ProcessCommandRepository,
    private readonly policies: PolicyRepository,
    private readonly states: StateCatalog,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: CreateContactInput) {
    const now = this.clock.now();
    const contactedAt = input.contacted_at
      ? new Date(input.contacted_at)
      : input.contact_date
        ? new Date(`${input.contact_date}T12:00:00Z`)
        : now;
    if (contactedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw new BusinessRuleError('A data do contacto não pode ser futura');
    if (now.getTime() - contactedAt.getTime() > MAX_BACKDATE_DAYS * 86_400_000) {
      throw new BusinessRuleError(`Só é possível registar contactos dos últimos ${MAX_BACKDATE_DAYS} dias`);
    }
    const status = input.status ?? 'attempted';

    return this.uow.run(async () => {
      if (!(await this.processes.findOpen(input.processe_id))) throw new NotFoundError('Processo não encontrado ou fechado');
      // limite de contactos por processo definido na régua master (o lock do processo serializa registos simultâneos)
      const limits = await this.policies.limitsForProcess(input.processe_id);
      if (limits?.maxContactsPerProcess != null && limits.contactsCount >= limits.maxContactsPerProcess) {
        throw new BusinessRuleError(`Limite de ${limits.maxContactsPerProcess} contactos por processo atingido (régua master). Fale com o gestor.`);
      }
      const id = await this.contacts.create({
        processId: input.processe_id,
        userId: input.userId,
        contactTypeId: input.contact_type_id,
        status,
        contactedAt,
        notes: input.notes?.trim() || null,
        durationSeconds: input.duration ?? null,
      });
      await this.contacts.touchProcessSummary(input.processe_id, contactedAt, status);
      // 1.º contacto = cobrança arrancou: REGISTADO → "Em cobrança" (não mexe nos outros estados)
      const [registered, inProgress] = await Promise.all([
        this.states.processStateId(ProcessStateCode.REGISTERED),
        this.states.processStateId(ProcessStateCode.IN_PROGRESS),
      ]);
      const started = await this.processes.startCollection([input.processe_id], registered, inProgress);
      if (started) await this.audit.record({ action: 'PROCESS_COLLECTION_STARTED', entity: 'process', entityId: input.processe_id, payload: { reason: 'CONTACT' } });
      await this.audit.record({ action: 'CONTACT_CREATED', entity: 'contact', entityId: id, payload: { processId: input.processe_id, status } });
      return { id };
    });
  }
}
