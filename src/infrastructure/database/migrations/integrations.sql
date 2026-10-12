-- =====================================================================
-- Integração com o ERP (SAP) — UM único ERP para toda a aplicação.
--  integration_settings          : a ligação (uma linha, id = 1, como a régua master)
--  integration_company_creditors : empresa no ERP (company code) → credor no Cobraqui
--  integration_runs              : cada execução (agendada ou manual), com contadores e relatório
--  external_refs                 : registo do ERP ↔ registo do Cobraqui (idempotência)
--  integration_review_items      : o que a integração não decide sozinha
-- =====================================================================

-- motivo do fecho do processo: até aqui só fechava pela liquidação de um acordo
ALTER TABLE processes ADD COLUMN closed_reason varchar(30)
  CONSTRAINT ck_processes_closed_reason CHECK (closed_reason IN ('NEGOTIATION_COMPLETED','PAID_IN_ERP','CANCELLED_IN_ERP','MANUAL'));
UPDATE processes SET closed_reason = 'NEGOTIATION_COMPLETED' WHERE closed_at IS NOT NULL AND closed_reason IS NULL;

CREATE TABLE integration_settings (
  id                    smallint PRIMARY KEY DEFAULT 1 CONSTRAINT ck_integration_settings_singleton CHECK (id = 1),
  provider              varchar(20) NOT NULL DEFAULT 'SAP_S4' CHECK (provider IN ('SAP_S4','SAP_B1','FILE','SANDBOX')),
  status                varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ERROR')),
  config                jsonb NOT NULL DEFAULT '{}'::jsonb,        -- URL, filtros (nunca segredos)
  credentials_enc       text,                                       -- AES-256-GCM (INTEGRATIONS_ENCRYPTION_KEY)
  auto_close            boolean NOT NULL DEFAULT false,             -- desligado: processos prontos a fechar vão para revisão
  import_debtors        boolean NOT NULL DEFAULT true,
  interval_minutes      int NOT NULL DEFAULT 60 CHECK (interval_minutes BETWEEN 5 AND 1440),
  next_run_at           timestamptz,
  last_run_at           timestamptz,
  last_success_at       timestamptz,
  last_full_run_at      timestamptz,
  consecutive_failures  int NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  cursors               jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id         int REFERENCES users(id) ON DELETE RESTRICT, -- em nome de quem a integração cria facturas (quem a activou)
  updated_by_id         int REFERENCES users(id) ON DELETE RESTRICT,
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO integration_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE integration_company_creditors (
  company_code     varchar(40) PRIMARY KEY,
  organization_id  int NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integration_runs (
  id               bigserial PRIMARY KEY,
  trigger          varchar(10) NOT NULL CHECK (trigger IN ('SCHEDULE','MANUAL')),
  mode             varchar(10) NOT NULL CHECK (mode IN ('DELTA','FULL','DRY_RUN')),
  provider         varchar(20) NOT NULL,
  status           varchar(10) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCESS','PARTIAL','FAILED')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  counters         jsonb NOT NULL DEFAULT '{}'::jsonb,
  report           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- acções (simulação) e erros por registo, com tecto
  error            text,
  triggered_by_id  int REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX ix_integration_runs_started ON integration_runs (started_at DESC);
CREATE INDEX ix_integration_runs_running ON integration_runs (id) WHERE status = 'RUNNING';

CREATE TABLE external_refs (
  id                     bigserial PRIMARY KEY,
  entity                 varchar(10) NOT NULL CHECK (entity IN ('DEBTOR','INVOICE')),
  external_id            varchar(120) NOT NULL,
  local_id               int NOT NULL,
  company_code           varchar(40),
  external_status        varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (external_status IN ('OPEN','PARTIAL','CLEARED','CANCELLED')),
  external_amount        numeric(18,2),
  external_open_amount   numeric(18,2),
  linked_by              varchar(10) NOT NULL CHECK (linked_by IN ('IMPORT','MATCH','MANUAL')),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  status_changed_at      timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_external_refs_external ON external_refs (entity, external_id);
CREATE UNIQUE INDEX ux_external_refs_local ON external_refs (entity, local_id);
-- verificação completa: facturas ainda abertas no ERP segundo a última leitura
CREATE INDEX ix_external_refs_open_invoices ON external_refs (last_seen_at) WHERE entity = 'INVOICE' AND external_status IN ('OPEN','PARTIAL');

CREATE TABLE integration_review_items (
  id               bigserial PRIMARY KEY,
  run_id           bigint REFERENCES integration_runs(id) ON DELETE SET NULL,
  kind             varchar(40) NOT NULL CHECK (kind IN (
                     'PROCESS_READY_TO_CLOSE','PAID_WITH_AGREEMENT','CANCELLED_WITH_AGREEMENT','PARTIAL_WITH_AGREEMENT',
                     'AMOUNT_CHANGED_WITH_AGREEMENT','PAID_IN_DISPUTE','PAYMENT_REVERSED','MISSING_IN_ERP',
                     'AMBIGUOUS_MATCH','DEBTOR_INCOMPLETE','DEBTOR_CONFLICT','UNMAPPED_COMPANY','INVALID_DATA')),
  external_id      varchar(120) NOT NULL,
  invoice_id       int REFERENCES invoices(id) ON DELETE CASCADE,
  process_id       int REFERENCES processes(id) ON DELETE SET NULL,
  summary          text NOT NULL,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','IGNORED')),
  resolution       text,
  resolved_by_id   int REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at      timestamptz,
  version          int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_review_resolution CHECK (status = 'OPEN' OR (resolved_by_id IS NOT NULL AND resolved_at IS NOT NULL))
);
-- o mesmo caso não abre duas vezes enquanto estiver por resolver
CREATE UNIQUE INDEX ux_integration_review_open ON integration_review_items (kind, external_id) WHERE status = 'OPEN';
CREATE INDEX ix_integration_review_status ON integration_review_items (status, created_at DESC);
