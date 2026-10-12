import { Injectable, Logger } from '@nestjs/common';
import { DebtorRepository } from '@/modules/debtors/domain/debtor.repository';
import { OrganizationRepository } from '@/modules/organizations/domain/organization.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ImportErrorReportWriter, ImportSummary, pick, RowError, SpreadsheetReader } from '../domain/spreadsheet.port';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Import de devedores. O original fazia ~5 queries POR LINHA (existência, organização com LIKE,
 * tipo com LIKE, insert devedor, insert contacto) e sem transacção.
 * Agora: 4 queries de lookup para o ficheiro inteiro + inserts em lote numa transacção.
 */
@Injectable()
export class ImportDebtorsUseCase {
  private readonly logger = new Logger(ImportDebtorsUseCase.name);
  static readonly MAX_ROWS = 10_000;

  constructor(
    private readonly reader: SpreadsheetReader,
    private readonly report: ImportErrorReportWriter,
    private readonly debtors: DebtorRepository,
    private readonly orgs: OrganizationRepository,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
  ) {}

  async execute(file: Buffer): Promise<ImportSummary> {
    const rows = (await this.reader.read(file, ImportDebtorsUseCase.MAX_ROWS)).map((r) => ({
      rowNumber: r.rowNumber,
      name: pick(r, 'Nome/Empresa', 'Nome'),
      email: pick(r, 'Email').toLowerCase(),
      phone: pick(r, 'Telefone'),
      address: pick(r, 'Endereço', 'Endereco'),
      organization: pick(r, 'Empresa Associada', 'Organização'),
      nif: pick(r, 'NIF'),
      type: pick(r, 'Tipo'),
      socialReason: pick(r, 'Razão Social'),
      contactName: pick(r, 'Pessoa de Contacto'),
      contactEmail: pick(r, 'email/pessoa de contacto', 'email pessoa de contacto').toLowerCase(),
      contactPhone: pick(r, 'Telefone/pessoa de contacto', 'telefone pessoa de contacto'),
      contactPosition: pick(r, 'Posição/pessoa de contacto', 'posicao pessoa de contacto'),
    }));

    const [existing, orgIds, typeRows] = await Promise.all([
      this.debtors.existingIdentityKeys({ names: rows.map((r) => r.name), emails: rows.map((r) => r.email), phones: rows.map((r) => r.phone), nifs: rows.map((r) => r.nif) }),
      this.orgs.findIdsByNames(rows.map((r) => r.organization)),
      this.ds.query('SELECT id, lower(name) AS key, is_company AS "isCompany" FROM debtor_types') as Promise<Array<{ id: number; key: string; isCompany: boolean }>>,
    ]);
    const types = new Map(typeRows.map((t) => [t.key, t]));

    const errors: RowError[] = [];
    const seen = { names: new Set<string>(), emails: new Set<string>(), phones: new Set<string>(), nifs: new Set<string>() };
    const valid: Parameters<DebtorRepository['bulkCreate']>[0] = [];

    for (const r of rows) {
      const e: string[] = [];
      if (!r.name) e.push('Nome obrigatório');
      if (!EMAIL.test(r.email)) e.push('Email inválido');
      if (!r.phone) e.push('Telefone obrigatório');
      if (!r.nif) e.push('NIF obrigatório');
      const dupDb = existing.names.has(r.name.toLowerCase()) || existing.emails.has(r.email) || existing.phones.has(r.phone.toLowerCase()) || existing.nifs.has(r.nif.toLowerCase());
      if (dupDb) e.push('Devedor já foi registado');
      const dupFile = seen.names.has(r.name.toLowerCase()) || seen.emails.has(r.email) || seen.phones.has(r.phone) || seen.nifs.has(r.nif.toLowerCase());
      if (dupFile) e.push('Duplicado no próprio ficheiro');
      const orgId = orgIds.get(r.organization.toLowerCase());
      if (!orgId) e.push('Empresa associada não encontrada');
      const type = types.get(r.type.toLowerCase());
      if (!type) e.push('Tipo de devedor não encontrado');
      if (!r.contactName || !EMAIL.test(r.contactEmail)) e.push('Pessoa de contacto inválida');

      if (e.length) {
        errors.push({ rowNumber: r.rowNumber, errors: e });
        continue;
      }
      seen.names.add(r.name.toLowerCase());
      seen.emails.add(r.email);
      seen.phones.add(r.phone);
      seen.nifs.add(r.nif.toLowerCase());
      valid.push({
        debtor: {
          name: r.name,
          email: r.email,
          phoneNumber: r.phone,
          address: r.address || '-',
          nif: r.nif,
          socialReason: r.socialReason || null,
          organizationId: orgId!,
          debtorTypeId: type!.id,
          isCompany: type!.isCompany,
        },
        contact: { name: r.contactName, email: r.contactEmail, contact: r.contactPhone || '-', position: r.contactPosition || '-' },
      });
    }

    const imported = valid.length
      ? await this.uow.run(async () => {
          const n = await this.debtors.bulkCreate(valid);
          await this.audit.record({ action: 'DEBTORS_IMPORTED', entity: 'debtor', payload: { imported: n, failed: errors.length } });
          return n;
        })
      : 0;
    const errorReport = errors.length ? await this.report.write(file, errors, 'erros_devedores') : undefined;
    this.logger.log({ total: rows.length, imported, failed: errors.length }, 'Import de devedores concluído');
    return { total: rows.length, imported, failed: errors.length, errors, errorReport };
  }
}
