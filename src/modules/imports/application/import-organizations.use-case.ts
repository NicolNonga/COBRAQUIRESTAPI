import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrganizationRepository } from '@/modules/organizations/domain/organization.repository';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { ImportErrorReportWriter, ImportSummary, pick, RowError, SpreadsheetReader } from '../domain/spreadsheet.port';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class ImportOrganizationsUseCase {
  constructor(
    private readonly reader: SpreadsheetReader,
    private readonly report: ImportErrorReportWriter,
    private readonly orgs: OrganizationRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  async execute(file: Buffer): Promise<ImportSummary> {
    const rows = (await this.reader.read(file, 5_000)).map((r) => ({
      rowNumber: r.rowNumber,
      name: pick(r, 'Nome'),
      email: pick(r, 'Email', 'Email').toLowerCase(),
      phoneNumber: pick(r, 'Telefone'),
      address: pick(r, 'Endereço', 'Endereco'),
    }));

    // duplicados com credores já registados (nome, email e telefone são únicos)
    const existing = (await this.ds.query(
      `SELECT name, lower(email) AS email, phone_number AS phone FROM organizations
        WHERE lower(name) = ANY($1::text[]) OR lower(email) = ANY($2::text[]) OR phone_number = ANY($3::text[])`,
      [rows.map((r) => r.name.toLowerCase()), rows.map((r) => r.email), rows.map((r) => r.phoneNumber)],
    )) as Array<{ name: string; email: string; phone: string }>;
    const dbName = new Map(existing.map((o) => [o.name.toLowerCase(), o.name]));
    const dbEmail = new Map(existing.map((o) => [o.email, o.name]));
    const dbPhone = new Map(existing.map((o) => [o.phone, o.name]));
    const seen = { name: new Map<string, number>(), email: new Map<string, number>(), phone: new Map<string, number>() };

    const errors: RowError[] = [];
    const valid: Array<{ name: string; email: string; phoneNumber: string; address: string; logoPath: null }> = [];
    for (const r of rows) {
      const e: string[] = [];
      if (!r.name) e.push('Nome obrigatório');
      if (!r.email) e.push('Email obrigatório');
      else if (!EMAIL_RE.test(r.email)) e.push(`Email "${r.email}" inválido`);
      if (!r.phoneNumber) e.push('Telefone obrigatório');

      const n = r.name.toLowerCase();
      if (r.name && dbName.has(n)) e.push(`Já existe um credor chamado "${dbName.get(n)}"`);
      else if (r.name && seen.name.has(n)) e.push(`Nome repetido no ficheiro (linha ${seen.name.get(n)})`);
      if (r.email && dbEmail.has(r.email)) e.push(`O email ${r.email} já pertence ao credor "${dbEmail.get(r.email)}"`);
      else if (r.email && seen.email.has(r.email)) e.push(`Email repetido no ficheiro (linha ${seen.email.get(r.email)})`);
      if (r.phoneNumber && dbPhone.has(r.phoneNumber)) e.push(`O telefone ${r.phoneNumber} já pertence ao credor "${dbPhone.get(r.phoneNumber)}"`);
      else if (r.phoneNumber && seen.phone.has(r.phoneNumber)) e.push(`Telefone repetido no ficheiro (linha ${seen.phone.get(r.phoneNumber)})`);

      if (e.length) { errors.push({ rowNumber: r.rowNumber, errors: e }); continue; }
      seen.name.set(n, r.rowNumber); seen.email.set(r.email, r.rowNumber); seen.phone.set(r.phoneNumber, r.rowNumber);
      // o original fixava address = 'Belas' para todas as linhas
      valid.push({ name: r.name, email: r.email, phoneNumber: r.phoneNumber, address: r.address || '-', logoPath: null });
    }

    const imported = valid.length
      ? await this.uow.run(async () => {
          const n = await this.orgs.bulkInsertIgnoringDuplicates(valid);
          await this.audit.record({ action: 'ORGANIZATIONS_IMPORTED', entity: 'organization', payload: { imported: n, failed: errors.length } });
          return n;
        })
      : 0;
    // corrida rara: outro utilizador criou o mesmo credor entretanto
    const lost = valid.length - imported;
    const failed = errors.length + lost;
    const errorReport = errors.length ? await this.report.write(file, errors, 'erros_credores') : undefined;
    return { total: rows.length, imported, failed, errors, errorReport };
  }
}
