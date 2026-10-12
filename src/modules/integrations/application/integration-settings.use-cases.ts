import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { BusinessRuleError, ConflictError, ValidationError } from '@/shared/domain/errors';
import { ErpProvider } from '../domain/canonical';
import { ErpConnectorFactory } from '../domain/erp-connector.port';
import { CompanyCreditor, IntegrationRunRepository, IntegrationSettingsRepository, ReviewRepository } from '../domain/integration.repository';
import { CredentialVault } from '../infrastructure/credential-vault';

/** fornecedores que exigem credenciais antes de activar */
const NEEDS_CREDENTIALS: ReadonlySet<ErpProvider> = new Set(['SAP_S4', 'SAP_B1']);
const TEST_TIMEOUT_MS = 30_000;

/** Vista da integração para o ecrã: nunca inclui as credenciais. */
@Injectable()
export class GetIntegrationUseCase {
  constructor(
    private readonly settings: IntegrationSettingsRepository,
    private readonly runs: IntegrationRunRepository,
    private readonly reviews: ReviewRepository,
    private readonly factory: ErpConnectorFactory,
  ) {}

  async execute() {
    const s = await this.settings.get();
    const { credentialsEnc, ...rest } = s;
    return {
      ...rest,
      hasCredentials: !!credentialsEnc,
      providers: this.factory.providers(),
      openReviews: await this.reviews.countOpen(),
      lastRun: await this.runs.latest(),
    };
  }
}

export interface UpdateIntegrationInput {
  version: number;
  provider?: ErpProvider;
  config?: Record<string, unknown>;
  autoClose?: boolean;
  importDebtors?: boolean;
  intervalMinutes?: number;
  companies?: CompanyCreditor[];
}

@Injectable()
export class UpdateIntegrationUseCase {
  constructor(
    private readonly settings: IntegrationSettingsRepository,
    private readonly factory: ErpConnectorFactory,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  execute(me: AuthenticatedUser, input: UpdateIntegrationInput) {
    return this.uow.run(async () => {
      const current = await this.settings.getForUpdate();
      if (current.version !== input.version) throw new ConflictError('A configuração foi alterada por outra pessoa. Recarregue e tente de novo.');
      const provider = input.provider ?? current.provider;
      const config = input.config ?? current.config;
      if (input.provider || input.config) {
        const errors = this.factory.validateConfig(provider, config);
        if (errors.length) throw new ValidationError('Configuração inválida', { errors });
      }
      if (input.companies) {
        const codes = input.companies.map((c) => c.companyCode.trim());
        if (codes.some((c) => !c)) throw new ValidationError('Indique o código de cada empresa do ERP');
        if (new Set(codes).size !== codes.length) throw new ValidationError('Empresa do ERP repetida');
        const ids = [...new Set(input.companies.map((c) => c.organizationId))];
        const found: Array<{ id: number }> = await this.ds.query('SELECT id FROM organizations WHERE id = ANY($1)', [ids]);
        const missing = ids.filter((id) => !found.some((f) => f.id === id));
        if (missing.length) throw new ValidationError('Credor não encontrado', { organizationIds: missing });
        await this.settings.replaceCompanies(input.companies.map((c) => ({ companyCode: c.companyCode.trim(), organizationId: c.organizationId })));
      }
      const ok = await this.settings.update(
        { provider: input.provider, config: input.config, autoClose: input.autoClose, importDebtors: input.importDebtors, intervalMinutes: input.intervalMinutes },
        input.version,
        me.id,
      );
      if (!ok) throw new ConflictError('A configuração foi alterada por outra pessoa. Recarregue e tente de novo.');
      await this.audit.record({
        action: 'INTEGRATION_UPDATED',
        entity: 'integration',
        entityId: 1,
        payload: { provider, autoClose: input.autoClose, importDebtors: input.importDebtors, intervalMinutes: input.intervalMinutes, companies: input.companies, configKeys: input.config ? Object.keys(input.config) : undefined },
      });
      return this.settings.get();
    });
  }
}

@Injectable()
export class SetIntegrationCredentialsUseCase {
  constructor(
    private readonly settings: IntegrationSettingsRepository,
    private readonly vault: CredentialVault,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  /** objecto vazio = apagar as credenciais */
  execute(me: AuthenticatedUser, credentials: Record<string, string>) {
    const clean = Object.fromEntries(Object.entries(credentials).filter(([, v]) => typeof v === 'string' && v.length > 0));
    const encrypted = Object.keys(clean).length ? this.vault.encrypt(clean) : null;
    return this.uow.run(async () => {
      await this.settings.setCredentials(encrypted, me.id);
      // só os nomes dos campos: os valores nunca vão para a auditoria
      await this.audit.record({ action: 'INTEGRATION_CREDENTIALS_CHANGED', entity: 'integration', entityId: 1, payload: { fields: Object.keys(clean), cleared: !encrypted } });
      return { hasCredentials: !!encrypted };
    });
  }
}

@Injectable()
export class TestIntegrationUseCase {
  constructor(
    private readonly settings: IntegrationSettingsRepository,
    private readonly factory: ErpConnectorFactory,
    private readonly vault: CredentialVault,
  ) {}

  async execute() {
    const s = await this.settings.get();
    const connector = this.factory.create(s.provider, s.config, s.credentialsEnc ? this.vault.decrypt(s.credentialsEnc) : null);
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      const check = await Promise.race([
        connector.testConnection(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new BusinessRuleError(`O ERP não respondeu em ${TEST_TIMEOUT_MS / 1000} segundos`)), TEST_TIMEOUT_MS);
        }),
      ]);
      const mapped = new Set(s.companies.map((c) => c.companyCode));
      return { ok: true, durationMs: Date.now() - started, ...check, newCreditors: check.companyCodes.filter((c) => !mapped.has(c)) };
    } catch (e) {
      if (e instanceof BusinessRuleError) throw e;
      throw new BusinessRuleError(`Não foi possível ligar ao ERP: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

@Injectable()
export class SetIntegrationStatusUseCase {
  constructor(
    private readonly settings: IntegrationSettingsRepository,
    private readonly factory: ErpConnectorFactory,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  activate(me: AuthenticatedUser) {
    return this.uow.run(async () => {
      const s = await this.settings.getForUpdate();
      const provider = this.factory.providers().find((p) => p.provider === s.provider);
      if (!provider?.available) throw new BusinessRuleError(`O conector ${provider?.label ?? s.provider} ainda não está disponível nesta versão`);
      const errors = this.factory.validateConfig(s.provider, s.config);
      if (errors.length) throw new ValidationError('Configuração inválida', { errors });
      if (NEEDS_CREDENTIALS.has(s.provider) && !s.credentialsEnc) throw new BusinessRuleError('Grave as credenciais do ERP antes de activar');
      // as facturas criadas pela integração ficam em nome de quem a activou
      await this.settings.setStatus('ACTIVE', me.id, { actorUserId: me.id, nextRunAt: new Date() });
      await this.audit.record({ action: 'INTEGRATION_ACTIVATED', entity: 'integration', entityId: 1, payload: { provider: s.provider } });
      return this.settings.get();
    });
  }

  pause(me: AuthenticatedUser) {
    return this.uow.run(async () => {
      await this.settings.setStatus('PAUSED', me.id);
      await this.audit.record({ action: 'INTEGRATION_PAUSED', entity: 'integration', entityId: 1 });
      return this.settings.get();
    });
  }
}
