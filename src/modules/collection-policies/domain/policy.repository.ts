import { CollectionPolicy, PolicyInput } from './policy';

export interface ProcessLimits {
  contactsCount: number;
  maxContactsPerProcess: number | null;
}

export abstract class PolicyRepository {
  /** a régua master (única); null só antes da migração semear a política inicial */
  abstract get(): Promise<CollectionPolicy | null>;
  /** lock pessimista: duas edições simultâneas não se atropelam */
  abstract getForUpdate(): Promise<CollectionPolicy | null>;
  /** grava (sempre a mesma linha), incrementa a versão e substitui as regras por tipo de passo */
  abstract save(input: PolicyInput, updatedById: number): Promise<CollectionPolicy>;
  /** contactos já registados no processo + limite da política, com lock do processo (serializa registos concorrentes) */
  abstract limitsForProcess(processId: number): Promise<ProcessLimits | null>;
}
