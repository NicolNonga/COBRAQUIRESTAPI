import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Custos da operação de cobrança (pessoal, comunicações, tecnologia…), lançados por data.
 * Servem o KPI "Custo por cobrança" = custos do período ÷ valor recuperado no período.
 * organization_id opcional: custo atribuível a um credor concreto (senão é custo geral).
 */
export class CollectionCosts1759790000000 implements MigrationInterface {
  name = 'CollectionCosts1759790000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS collection_costs (
        id               serial PRIMARY KEY,
        cost_date        date          NOT NULL,
        category         varchar(20)   NOT NULL CONSTRAINT ck_collection_costs_category
                         CHECK (category IN ('STAFF','COMMUNICATIONS','TECHNOLOGY','TRAVEL','LEGAL','OFFICE','OTHER')),
        description      varchar(255)  NOT NULL,
        amount           numeric(18,2) NOT NULL CONSTRAINT ck_collection_costs_amount CHECK (amount > 0),
        organization_id  int REFERENCES organizations(id) ON DELETE RESTRICT,
        created_by_id    int REFERENCES users(id) ON DELETE SET NULL,
        created_at       timestamptz   NOT NULL DEFAULT now(),
        updated_at       timestamptz   NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ix_collection_costs_date ON collection_costs (cost_date DESC);
      CREATE INDEX IF NOT EXISTS ix_contacts_contacted_at ON contacts (contacted_at DESC);
      CREATE INDEX IF NOT EXISTS ix_negotiations_broken_at ON negotiations (broken_at) WHERE broken_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ix_invoices_issue_date ON invoices (issue_date);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX IF EXISTS ix_invoices_issue_date;
      DROP INDEX IF EXISTS ix_negotiations_broken_at;
      DROP INDEX IF EXISTS ix_contacts_contacted_at;
      DROP TABLE IF EXISTS collection_costs;
    `);
  }
}
