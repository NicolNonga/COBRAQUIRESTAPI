-- =====================================================================
-- Cobra Aqui — schema PostgreSQL inicial
-- Regras gerais:
--   * dinheiro em NUMERIC(18,2) (nunca float/double);
--   * timestamps em TIMESTAMPTZ; datas de calendário em DATE;
--   * unicidade e invariantes garantidos pela BD (CHECK / UNIQUE / FK),
--     não apenas por "SELECT antes de INSERT" (que sofre race conditions);
--   * índices em todas as FKs usadas em JOIN/WHERE + índices parciais.
-- =====================================================================

CREATE TABLE categories (
  id          serial PRIMARY KEY,
  name        varchar(120) NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_categories_name ON categories (lower(name));

CREATE TABLE currencies (
  id          serial PRIMARY KEY,
  name        varchar(80) NOT NULL,
  code        varchar(3)  NOT NULL CHECK (code ~ '^[A-Z]{3}$'),
  symbol      varchar(10) NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_currencies_code ON currencies (code);

CREATE TABLE debtor_types (
  id          serial PRIMARY KEY,
  name        varchar(80) NOT NULL,
  description varchar(255),
  is_company  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_debtor_types_name ON debtor_types (lower(name));

CREATE TABLE contact_types (
  id          serial PRIMARY KEY,
  name        varchar(80) NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_contact_types_name ON contact_types (lower(name));

CREATE TABLE invoice_states (
  id         serial PRIMARY KEY,
  code       varchar(30) NOT NULL UNIQUE,
  name       varchar(80) NOT NULL UNIQUE,
  is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE process_states (
  id         serial PRIMARY KEY,
  code       varchar(30) NOT NULL UNIQUE,
  name       varchar(80) NOT NULL UNIQUE,
  is_active  boolean NOT NULL DEFAULT true
);

-- ------------------------------ acesso ------------------------------
CREATE TABLE permissions (
  id          serial PRIMARY KEY,
  slug        varchar(120) NOT NULL,
  name        varchar(120) NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_permissions_slug ON permissions (slug);
CREATE INDEX ix_permissions_created_at ON permissions (created_at DESC);

CREATE TABLE roles (
  id          serial PRIMARY KEY,
  slug        varchar(120) NOT NULL,
  name        varchar(120) NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  is_manager  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_roles_slug ON roles (slug);
CREATE UNIQUE INDEX ux_roles_name ON roles (lower(name));

CREATE TABLE role_permissions (
  role_id       int NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id int NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)          -- impede duplicados mesmo em corrida
);
CREATE INDEX ix_role_permissions_permission ON role_permissions (permission_id);

-- ------------------------------ organizações / utilizadores ------------------------------
CREATE TABLE organizations (
  id           serial PRIMARY KEY,
  name         varchar(200) NOT NULL,
  email        varchar(254) NOT NULL,
  phone_number varchar(30)  NOT NULL,
  address      text NOT NULL,
  logo_path    text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_organizations_email ON organizations (lower(email));
CREATE UNIQUE INDEX ux_organizations_name ON organizations (lower(name));
CREATE UNIQUE INDEX ux_organizations_phone_number ON organizations (phone_number);
CREATE INDEX ix_organizations_created_at ON organizations (created_at DESC);

CREATE TABLE users (
  id              serial PRIMARY KEY,
  full_name       varchar(200),
  email           varchar(254) NOT NULL,
  password_hash   varchar(100) NOT NULL,
  phone_number    varchar(30),
  role_id         int REFERENCES roles(id) ON DELETE RESTRICT,
  organization_id int REFERENCES organizations(id) ON DELETE RESTRICT,
  category_id     int REFERENCES categories(id) ON DELETE SET NULL,
  is_active       boolean NOT NULL DEFAULT true,
  first_access    boolean NOT NULL DEFAULT true,
  token_version   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));            -- login case-insensitive
CREATE UNIQUE INDEX ux_users_phone_number ON users (phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX ix_users_role ON users (role_id);
CREATE INDEX ix_users_organization ON users (organization_id);
CREATE INDEX ix_users_category ON users (category_id);
CREATE INDEX ix_users_created_at ON users (created_at DESC);

CREATE TABLE wallet_agents (
  id          serial PRIMARY KEY,
  agent_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_id  int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_wallet_agents_not_self CHECK (agent_id <> manager_id)
);
CREATE UNIQUE INDEX ux_wallet_agents_agent ON wallet_agents (agent_id);   -- 1 gestor por agente
CREATE INDEX ix_wallet_agents_manager ON wallet_agents (manager_id);

CREATE TABLE password_reset_tokens (
  id          bigserial PRIMARY KEY,
  email       varchar(254) NOT NULL,
  token_hash  char(64) NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_password_reset_tokens_hash ON password_reset_tokens (token_hash);
CREATE INDEX ix_password_reset_tokens_email_open ON password_reset_tokens (lower(email)) WHERE used_at IS NULL;

-- ------------------------------ devedores ------------------------------
CREATE TABLE debtors (
  id               serial PRIMARY KEY,
  name             varchar(200) NOT NULL,
  nif              varchar(30),
  email            varchar(254) NOT NULL,
  phone_number     varchar(30)  NOT NULL,
  address          text NOT NULL,
  logo_path        text,
  social_reason    varchar(200),
  is_company       boolean NOT NULL DEFAULT true,
  is_active        boolean NOT NULL DEFAULT true,
  organization_id  int NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  debtor_type_id   int NOT NULL REFERENCES debtor_types(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_debtors_email ON debtors (lower(email));
CREATE UNIQUE INDEX ux_debtors_nif ON debtors (lower(nif)) WHERE nif IS NOT NULL;
CREATE UNIQUE INDEX ux_debtors_phone_number ON debtors (phone_number);
CREATE UNIQUE INDEX ux_debtors_name ON debtors (lower(name));
CREATE INDEX ix_debtors_organization ON debtors (organization_id);
CREATE INDEX ix_debtors_type ON debtors (debtor_type_id);
CREATE INDEX ix_debtors_created_at ON debtors (created_at DESC);
CREATE INDEX ix_debtors_active_name ON debtors (name) WHERE is_active;   -- dropdowns

CREATE TABLE debtor_contact_persons (
  id          serial PRIMARY KEY,
  debtor_id   int NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
  name        varchar(150) NOT NULL,
  email       varchar(254) NOT NULL,
  contact     varchar(50)  NOT NULL,
  position    varchar(80)  NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_debtor_contact_persons_debtor ON debtor_contact_persons (debtor_id);  -- 1:1

CREATE TABLE user_wallets (
  id          serial PRIMARY KEY,
  debtor_id   int NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
  user_id     int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_user_wallets_debtor ON user_wallets (debtor_id);  -- devedor em 1 só carteira
CREATE INDEX ix_user_wallets_user ON user_wallets (user_id, created_at DESC);

-- ------------------------------ facturas ------------------------------
CREATE TABLE invoices (
  id                serial PRIMARY KEY,
  reference_number  varchar(100) NOT NULL,
  amount            numeric(18,2) NOT NULL CONSTRAINT ck_invoices_amount_positive CHECK (amount > 0),
  issue_date        date NOT NULL,
  time_limit_days   int  NOT NULL CONSTRAINT ck_invoices_time_limit CHECK (time_limit_days BETWEEN 0 AND 3650),
  due_date          date NOT NULL,
  document_path     text,
  in_process        boolean NOT NULL DEFAULT false,
  debtor_id         int NOT NULL REFERENCES debtors(id) ON DELETE RESTRICT,
  currency_id       int NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT,
  invoice_state_id  int NOT NULL REFERENCES invoice_states(id) ON DELETE RESTRICT,
  created_by_id     int NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_invoices_due_after_issue CHECK (due_date >= issue_date)
);
CREATE UNIQUE INDEX ux_invoices_reference_number ON invoices (lower(reference_number));
CREATE INDEX ix_invoices_debtor ON invoices (debtor_id);
CREATE INDEX ix_invoices_currency ON invoices (currency_id);
CREATE INDEX ix_invoices_created_by ON invoices (created_by_id);
CREATE INDEX ix_invoices_created_at ON invoices (created_at DESC);
CREATE INDEX ix_invoices_state_due ON invoices (invoice_state_id, due_date);         -- job "vencidas"
CREATE INDEX ix_invoices_overdue_not_in_process ON invoices (invoice_state_id, debtor_id) WHERE NOT in_process; -- job "gerar processos"
CREATE INDEX ix_invoices_without_document ON invoices (id) WHERE document_path IS NULL; -- import de PDFs

-- ------------------------------ processos ------------------------------
CREATE TABLE processes (
  id                serial PRIMARY KEY,
  debtor_id         int NOT NULL REFERENCES debtors(id) ON DELETE RESTRICT,
  process_state_id  int NOT NULL REFERENCES process_states(id) ON DELETE RESTRICT,
  start_date        timestamptz,
  end_date          timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- no máximo UM processo aberto por devedor: torna a geração idempotente e à prova de corrida
CREATE UNIQUE INDEX ux_processes_open_debtor ON processes (debtor_id) WHERE closed_at IS NULL;
CREATE INDEX ix_processes_debtor ON processes (debtor_id);
CREATE INDEX ix_processes_state ON processes (process_state_id);
CREATE INDEX ix_processes_created_at ON processes (created_at DESC);

CREATE TABLE process_invoices (
  id          serial PRIMARY KEY,
  process_id  int NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  invoice_id  int NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_process_invoices_invoice ON process_invoices (invoice_id);   -- factura em 1 só processo
CREATE INDEX ix_process_invoices_process ON process_invoices (process_id, created_at DESC);

CREATE TABLE process_assignments (
  id          serial PRIMARY KEY,
  process_id  int NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  user_id     int NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_process_assignments_process ON process_assignments (process_id);  -- 1 responsável
CREATE INDEX ix_process_assignments_user ON process_assignments (user_id, created_at DESC);

CREATE TABLE process_transfers (
  id              serial PRIMARY KEY,
  process_id      int NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  from_user_id    int NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_user_id      int NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  performed_by_id int REFERENCES users(id) ON DELETE SET NULL,
  reason          varchar(500) NOT NULL,
  notes           text,
  is_permanent    boolean NOT NULL DEFAULT true,
  return_at       timestamptz,
  returned_at     timestamptz,
  status          varchar(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','RETURNED','CANCELLED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_process_transfers_users CHECK (from_user_id <> to_user_id),
  CONSTRAINT ck_process_transfers_temporary CHECK (is_permanent OR return_at IS NOT NULL)
);
CREATE INDEX ix_process_transfers_process ON process_transfers (process_id, created_at DESC);
CREATE INDEX ix_process_transfers_from ON process_transfers (from_user_id);
CREATE INDEX ix_process_transfers_to ON process_transfers (to_user_id);
CREATE INDEX ix_process_transfers_due_return ON process_transfers (return_at)
  WHERE NOT is_permanent AND status = 'COMPLETED' AND returned_at IS NULL;               -- job de devolução

CREATE TABLE contacts (
  id               serial PRIMARY KEY,
  process_id       int NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  user_id          int NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  contact_type_id  int NOT NULL REFERENCES contact_types(id) ON DELETE RESTRICT,
  status           varchar(30) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('attempted','answered','negotiation_started','no_answer','failed','pending')),
  contact_date     date,
  duration_seconds int CHECK (duration_seconds >= 0),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_contacts_process ON contacts (process_id);   -- regra do sistema original: 1 contacto por processo
CREATE INDEX ix_contacts_user ON contacts (user_id);
CREATE INDEX ix_contacts_type ON contacts (contact_type_id);

-- ------------------------------ negociações ------------------------------
CREATE TABLE negotiations (
  id                    serial PRIMARY KEY,
  debt_amount           numeric(18,2) NOT NULL CHECK (debt_amount > 0),
  discount_amount       numeric(18,2) NOT NULL CHECK (discount_amount >= 0),
  discount_rate         numeric(7,4)  NOT NULL CHECK (discount_rate BETWEEN 0 AND 100),
  total_amount          numeric(18,2) NOT NULL CHECK (total_amount > 0),
  final_amount          numeric(18,2) NOT NULL CHECK (final_amount > 0),
  effective_date        date NOT NULL,
  start_date            date NOT NULL,
  end_date              date NOT NULL,
  is_installment        boolean NOT NULL DEFAULT false,
  is_equal_installments boolean NOT NULL DEFAULT false,
  total_installments    int CHECK (total_installments BETWEEN 1 AND 360),
  status                varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','COMPLETED')),
  notes                 text,
  created_by_id         int REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at          timestamptz,
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- invariantes financeiros redundantes ao domínio (defesa em profundidade)
  CONSTRAINT ck_negotiations_total CHECK (total_amount = debt_amount - discount_amount),
  CONSTRAINT ck_negotiations_final CHECK (final_amount <= total_amount),
  CONSTRAINT ck_negotiations_dates CHECK (effective_date <= start_date AND start_date < end_date),
  CONSTRAINT ck_negotiations_installments CHECK (is_installment = (total_installments IS NOT NULL))
);
CREATE INDEX ix_negotiations_created_at ON negotiations (created_at DESC);
CREATE INDEX ix_negotiations_status ON negotiations (status, created_at DESC);
CREATE INDEX ix_negotiations_created_by ON negotiations (created_by_id);

CREATE TABLE negotiation_processes (
  id              serial PRIMARY KEY,
  negotiation_id  int NOT NULL REFERENCES negotiations(id) ON DELETE CASCADE,
  process_id      int NOT NULL REFERENCES processes(id) ON DELETE RESTRICT,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_negotiation_processes_pair ON negotiation_processes (negotiation_id, process_id);
-- um processo só pode estar numa negociação ACTIVA (barreira final contra corrida)
CREATE UNIQUE INDEX ux_negotiation_processes_active ON negotiation_processes (process_id) WHERE is_active;
CREATE INDEX ix_negotiation_processes_process ON negotiation_processes (process_id);

CREATE TABLE negotiation_installments (
  id                  serial PRIMARY KEY,
  negotiation_id      int NOT NULL REFERENCES negotiations(id) ON DELETE CASCADE,
  installment_number  int NOT NULL CHECK (installment_number >= 1),
  amount              numeric(18,2) NOT NULL CHECK (amount > 0),
  percentage          numeric(7,4)  NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  due_date            date NOT NULL,
  penalty_percentage  numeric(5,2)  NOT NULL CHECK (penalty_percentage >= 0),
  status              varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','OVERDUE','CANCELLED')),
  paid_at             timestamptz,
  version             int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_negotiation_installments_number ON negotiation_installments (negotiation_id, installment_number);
CREATE INDEX ix_negotiation_installments_status_due ON negotiation_installments (status, due_date) WHERE status IN ('PENDING','OVERDUE');

-- ------------------------------ notificações ------------------------------
CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        varchar(50) NOT NULL,
  title       varchar(150),
  message     text NOT NULL,
  data        jsonb,
  is_read     boolean NOT NULL DEFAULT false,
  read_at     timestamptz,
  priority    varchar(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  action_url  varchar(500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX ix_notifications_user_unread ON notifications (user_id) WHERE NOT is_read;  -- contador de não lidas
CREATE INDEX ix_notifications_read_created ON notifications (created_at) WHERE is_read;  -- limpeza

-- ------------------------------ transversais ------------------------------
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  action      varchar(80) NOT NULL,
  entity      varchar(60) NOT NULL,
  entity_id   varchar(60),
  actor_id    int,
  request_id  varchar(64),
  ip          varchar(64),
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_logs_entity ON audit_logs (entity, entity_id);
CREATE INDEX ix_audit_logs_actor_created ON audit_logs (actor_id, created_at);
CREATE INDEX ix_audit_logs_created_at ON audit_logs USING brin (created_at);   -- tabela append-only

-- trilho de auditoria imutável: UPDATE/DELETE proibidos
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é append-only';
END $$;
CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE idempotency_keys (
  id               bigserial PRIMARY KEY,
  scope            varchar(200) NOT NULL,
  key              varchar(100) NOT NULL,
  request_hash     char(64) NOT NULL,
  status           varchar(20) NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response_status  int,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_idempotency_keys_scope_key ON idempotency_keys (scope, key);
CREATE INDEX ix_idempotency_keys_created_at ON idempotency_keys (created_at);
