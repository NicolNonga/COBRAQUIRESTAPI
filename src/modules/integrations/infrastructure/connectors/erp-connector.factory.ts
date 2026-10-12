import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessRuleError } from '@/shared/domain/errors';
import { ErpProvider } from '../../domain/canonical';
import { ErpConnector, ErpConnectorFactory } from '../../domain/erp-connector.port';
import { HttpTransport } from './sap-b1/http-transport';
import { SapB1Config, SapB1Connector } from './sap-b1/sap-b1.connector';
import { SandboxConnector, SandboxData } from './sandbox/sandbox.connector';

const LABEL: Record<ErpProvider, string> = {
  SAP_S4: 'SAP S/4HANA (OData)',
  SAP_B1: 'SAP Business One (Service Layer)',
  FILE: 'Ficheiro CSV',
  SANDBOX: 'Ambiente de testes',
};

const isHttps = (v: unknown) => typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v);

/**
 * Escolhe o conector pelo fornecedor configurado.
 * Disponíveis: SAP Business One (Service Layer) e, fora de produção, o ambiente de testes.
 * S/4HANA (OData) e ECC chegam quando a empresa decidir qual usa.
 */
@Injectable()
export class DefaultErpConnectorFactory extends ErpConnectorFactory {
  private readonly production: boolean;

  constructor(cfg: ConfigService, private readonly http: HttpTransport) {
    super();
    this.production = cfg.get('NODE_ENV') === 'production';
  }

  private available(p: ErpProvider): boolean {
    return p === 'SANDBOX' ? !this.production : p === 'SAP_B1';
  }

  providers() {
    return (Object.keys(LABEL) as ErpProvider[]).map((provider) => ({ provider, label: LABEL[provider], available: this.available(provider) }));
  }

  validateConfig(provider: ErpProvider, config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    switch (provider) {
      case 'SAP_S4':
        if (!isHttps(config.baseUrl)) errors.push('baseUrl: indique o endereço HTTPS do SAP Gateway');
        break;
      case 'SAP_B1':
        if (!isHttps(config.baseUrl)) errors.push('baseUrl: indique o endereço HTTPS do Service Layer');
        if (typeof config.companyDb !== 'string' || !config.companyDb) errors.push('companyDb: indique a base de dados da empresa no Business One');
        if (config.referenceField !== undefined && config.referenceField !== 'DocNum' && config.referenceField !== 'NumAtCard') errors.push('referenceField: use DocNum ou NumAtCard');
        if (config.localCurrency !== undefined && !(typeof config.localCurrency === 'string' && /^[A-Za-z]{3}$/.test(config.localCurrency))) errors.push('localCurrency: use o código ISO de 3 letras (ex.: AOA)');
        if (config.insecureTls === true && this.production) errors.push('insecureTls: não é permitido em produção; instale um certificado válido no Service Layer');
        break;
      case 'SANDBOX': {
        const s = config.sandbox as Partial<SandboxData> | undefined;
        if (!s || !Array.isArray(s.customers) || !Array.isArray(s.invoices)) errors.push('sandbox: indique { customers: [...], invoices: [...] }');
        break;
      }
      case 'FILE':
        break;
    }
    return errors;
  }

  create(provider: ErpProvider, config: Record<string, unknown>, credentials: Record<string, string> | null): ErpConnector {
    if (!this.available(provider)) {
      throw new BusinessRuleError(
        provider === 'SANDBOX' ? 'O ambiente de testes não está disponível em produção' : `O conector ${LABEL[provider]} ainda não está disponível nesta versão`,
      );
    }
    const errors = this.validateConfig(provider, config);
    if (errors.length) throw new BusinessRuleError(`Configuração inválida: ${errors.join('; ')}`);
    if (provider === 'SAP_B1') {
      if (!credentials?.username || !credentials.password) throw new BusinessRuleError('Grave o utilizador e a palavra-passe do Business One (credenciais) antes de ligar');
      return new SapB1Connector(config as unknown as SapB1Config, { username: credentials.username, password: credentials.password }, this.http);
    }
    return new SandboxConnector(config.sandbox as SandboxData);
  }
}
