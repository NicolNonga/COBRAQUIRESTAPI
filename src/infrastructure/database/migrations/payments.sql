-- =====================================================================
-- Pagamentos, alocação às parcelas, crédito do devedor, conta-corrente por credor e acertos.
--
-- Quem recebe o dinheiro (por pagamento):
--   CREDITOR → o devedor paga directamente ao credor (opção A); o sistema só regista.
--   AGENCY   → o devedor paga à empresa de cobrança (opção B), que depois repassa ao credor.
-- Comissão: % por credor (organizations.commission_rate), sobre o valor confirmado, nas duas opções.
--   A: o credor deve-nos a comissão;  B: retemos a comissão e devemos o resto ao credor.
--
-- Ciclo do pagamento:  PENDING ──confirmar──▶ CONFIRMED ──estornar──▶ REVERSED
--                          └──anular (motivo)──▶ CANCELLED
-- Nada é apagado: tudo é estado + quem + quando + motivo. Livros (ledgers) são append-only.
-- Todos os valores dos livros estão na moeda base (amount_base).
-- =====================================================================

-- ---------------------------------------------------------------- comissão por credor
ALTER TABLE organizations
  ADD COLUMN commission_rate numeric(5,2) NOT NULL DEFAULT 0
  CONSTRAINT ck_organizations_commission_rate CHECK (commission_rate >= 0 AND commission_rate <= 100);

-- ---------------------------------------------------------------- impede DELETE (e UPDATE nos livros)
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registo financeiro: % em % não é permitido', TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

-- ---------------------------------------------------------------- meios de pagamento
CREATE TABLE payment_methods (
  id                  serial PRIMARY KEY,
  name                varchar(80) NOT NULL,
  description         text,
  requires_reference  boolean NOT NULL DEFAULT true,   -- transferência exige nº; numerário não
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_payment_methods_name ON payment_methods (lower(name));

INSERT INTO payment_methods (name, requires_reference) VALUES
  ('Transferência bancária', true), ('Depósito bancário', true), ('Multicaixa / Referência', true), ('Numerário', false)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- pagamentos
CREATE TABLE payments (
  id                bigserial PRIMARY KEY,
  negotiation_id    int NOT NULL REFERENCES negotiations(id) ON DELETE RESTRICT,
  installment_id    int REFERENCES negotiation_installments(id) ON DELETE RESTRICT, -- parcela indicada (opcional); a alocação começa por ela
  debtor_id         int NOT NULL REFERENCES debtors(id) ON DELETE RESTRICT,         -- snapshot (crédito, painel)
  organization_id   int NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,   -- credor (conta-corrente, painel)
  receiver          varchar(10) NOT NULL CHECK (receiver IN ('CREDITOR','AGENCY')),
  amount            numeric(18,2) NOT NULL CHECK (amount > 0),                      -- na moeda do pagamento
  currency_id       int NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT,
  exchange_rate     numeric(18,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  amount_base       numeric(18,2) NOT NULL CHECK (amount_base > 0),                 -- valor que abate na dívida
  payment_method_id int NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  paid_on           date NOT NULL,                                                  -- data que consta no comprovativo
  reference         varchar(120),
  proof_path        text NOT NULL,                                                  -- comprovativo obrigatório
  notes             text,
  status            varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','REVERSED')),
  -- definidos na confirmação (snapshot: mudar a taxa do credor não altera o passado)
  commission_rate   numeric(5,2),
  commission_amount numeric(18,2),
  credit_amount     numeric(18,2),                                                  -- excedente que ficou como crédito do devedor
  registered_by_id  int NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_by_id   int REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at      timestamptz,
  cancelled_by_id   int REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at      timestamptz,
  cancel_reason     text,
  reversed_by_id    int REFERENCES users(id) ON DELETE RESTRICT,
  reversed_at       timestamptz,
  reverse_reason    text,
  version           int NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_payments_amount_base CHECK (amount_base = round(amount * exchange_rate, 2)),
  CONSTRAINT ck_payments_four_eyes CHECK (confirmed_by_id IS NULL OR confirmed_by_id <> registered_by_id),
  CONSTRAINT ck_payments_state_fields CHECK (
        (status NOT IN ('CONFIRMED','REVERSED') OR (confirmed_by_id IS NOT NULL AND confirmed_at IS NOT NULL
                                                    AND commission_amount IS NOT NULL AND credit_amount IS NOT NULL))
    AND (status <> 'CANCELLED' OR (cancelled_by_id IS NOT NULL AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
    AND (status <> 'REVERSED'  OR (reversed_by_id IS NOT NULL AND reversed_at IS NOT NULL AND reverse_reason IS NOT NULL))
  )
);
-- o mesmo comprovativo (meio + referência) não entra duas vezes, salvo se o anterior foi anulado/estornado
CREATE UNIQUE INDEX ux_payments_method_reference ON payments (payment_method_id, lower(reference))
  WHERE reference IS NOT NULL AND status IN ('PENDING','CONFIRMED');
CREATE INDEX ix_payments_negotiation ON payments (negotiation_id, created_at DESC);
CREATE INDEX ix_payments_negotiation_pending ON payments (negotiation_id, paid_on) WHERE status = 'PENDING';
CREATE INDEX ix_payments_pending ON payments (created_at) WHERE status = 'PENDING';          -- fila de confirmação
CREATE INDEX ix_payments_confirmed_org ON payments (organization_id, paid_on) WHERE status = 'CONFIRMED'; -- painel "recuperado"
CREATE INDEX ix_payments_debtor ON payments (debtor_id, created_at DESC);
CREATE INDEX ix_payments_registered_by ON payments (registered_by_id, created_at DESC);
CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ---------------------------------------------------------------- alocação do pagamento às parcelas
-- Ao confirmar: parcela indicada → parcelas seguintes em aberto (por vencimento) → excedente = crédito.
-- Coberto de uma parcela = Σ alocações não estornadas. O estorno marca reversed_at (não apaga).
CREATE TABLE payment_allocations (
  id              bigserial PRIMARY KEY,
  payment_id      bigint NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  negotiation_id  int NOT NULL REFERENCES negotiations(id) ON DELETE RESTRICT,
  installment_id  int REFERENCES negotiation_installments(id) ON DELETE RESTRICT,   -- NULL = acordo à vista
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  paid_on         date NOT NULL,                                                    -- do pagamento (regra da quebra)
  reversed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_payment_allocations_installment ON payment_allocations (installment_id) INCLUDE (amount, paid_on) WHERE reversed_at IS NULL;
CREATE INDEX ix_payment_allocations_negotiation ON payment_allocations (negotiation_id) INCLUDE (amount) WHERE reversed_at IS NULL;
CREATE INDEX ix_payment_allocations_payment ON payment_allocations (payment_id);
CREATE TRIGGER trg_payment_allocations_no_delete BEFORE DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ---------------------------------------------------------------- crédito do devedor (livro append-only)
CREATE TABLE debtor_credit_entries (
  id              bigserial PRIMARY KEY,
  debtor_id       int NOT NULL REFERENCES debtors(id) ON DELETE RESTRICT,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  negotiation_id  int REFERENCES negotiations(id) ON DELETE RESTRICT,
  payment_id      bigint REFERENCES payments(id) ON DELETE RESTRICT,
  kind            varchar(20) NOT NULL CHECK (kind IN ('OVERPAYMENT','REVERSAL','APPLIED')),
  amount          numeric(18,2) NOT NULL CHECK (amount <> 0),   -- + crédito a favor do devedor ; − consumo/estorno
  description     text NOT NULL,
  created_by_id   int REFERENCES users(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_debtor_credit_debtor ON debtor_credit_entries (debtor_id, created_at DESC) INCLUDE (amount);
CREATE TRIGGER trg_debtor_credit_immutable BEFORE UPDATE OR DELETE ON debtor_credit_entries FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ---------------------------------------------------------------- acertos com o credor (repasses e recebimento de comissão)
--   TO_CREDITOR   (opção B) repassamos ao credor o que recebemos em nome dele;
--   FROM_CREDITOR (opção A) o credor paga-nos a comissão.
-- Financeiro regista com comprovativo → outro utilizador confirma (quatro olhos) → entra na conta-corrente.
CREATE TABLE creditor_settlements (
  id               bigserial PRIMARY KEY,
  organization_id  int NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  direction        varchar(15) NOT NULL CHECK (direction IN ('TO_CREDITOR','FROM_CREDITOR')),
  amount           numeric(18,2) NOT NULL CHECK (amount > 0),
  settled_on       date NOT NULL,
  payment_method_id int NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  reference        varchar(120),
  proof_path       text NOT NULL,
  notes            text,
  status           varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  registered_by_id int NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_by_id  int REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at     timestamptz,
  cancelled_by_id  int REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at     timestamptz,
  cancel_reason    text,
  version          int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_settlements_four_eyes CHECK (confirmed_by_id IS NULL OR confirmed_by_id <> registered_by_id),
  CONSTRAINT ck_settlements_state_fields CHECK (
        (status <> 'CONFIRMED' OR (confirmed_by_id IS NOT NULL AND confirmed_at IS NOT NULL))
    AND (status <> 'CANCELLED' OR (cancelled_by_id IS NOT NULL AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
  )
);
CREATE INDEX ix_settlements_org ON creditor_settlements (organization_id, created_at DESC);
CREATE INDEX ix_settlements_pending ON creditor_settlements (organization_id, direction) INCLUDE (amount) WHERE status = 'PENDING';
CREATE UNIQUE INDEX ux_settlements_method_reference ON creditor_settlements (payment_method_id, lower(reference))
  WHERE reference IS NOT NULL AND status IN ('PENDING','CONFIRMED');
CREATE TRIGGER trg_settlements_no_delete BEFORE DELETE ON creditor_settlements FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ---------------------------------------------------------------- conta-corrente por credor (livro append-only)
-- Saldo = Σ amount.  > 0: devemos ao credor (repassar).  < 0: o credor deve-nos (comissões).
--   COLLECTED   +valor   pagamento confirmado recebido por nós (B)
--   COMMISSION  −comissão (A e B)
--   SETTLEMENT  −repasse TO_CREDITOR / +recebimento FROM_CREDITOR
-- Estorno de pagamento: lançamento inverso do MESMO tipo com reversal_of_id (no máximo um por lançamento).
CREATE TABLE creditor_ledger_entries (
  id               bigserial PRIMARY KEY,
  organization_id  int NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind             varchar(20) NOT NULL CHECK (kind IN ('COLLECTED','COMMISSION','SETTLEMENT')),
  amount           numeric(18,2) NOT NULL CHECK (amount <> 0),
  payment_id       bigint REFERENCES payments(id) ON DELETE RESTRICT,
  settlement_id    bigint REFERENCES creditor_settlements(id) ON DELETE RESTRICT,
  reversal_of_id   bigint REFERENCES creditor_ledger_entries(id) ON DELETE RESTRICT,
  description      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ledger_source CHECK ((payment_id IS NOT NULL) <> (settlement_id IS NOT NULL))
);
CREATE INDEX ix_creditor_ledger_org ON creditor_ledger_entries (organization_id, created_at DESC, id DESC) INCLUDE (amount);
CREATE INDEX ix_creditor_ledger_payment ON creditor_ledger_entries (payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX ux_creditor_ledger_reversal ON creditor_ledger_entries (reversal_of_id) WHERE reversal_of_id IS NOT NULL;
CREATE TRIGGER trg_creditor_ledger_immutable BEFORE UPDATE OR DELETE ON creditor_ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ---------------------------------------------------------------- permissões
INSERT INTO permissions (slug, name, description) VALUES
  ('payment_confirm_permission', 'Confirmar pagamentos', 'Confirmar, anular (pendentes) e estornar (confirmados) pagamentos'),
  ('payment_method_manage_permission', 'Gerir meios de pagamento', 'Criar/editar meios de pagamento e moedas'),
  ('creditor_settlement_permission', 'Acertos com credores', 'Registar e confirmar repasses e recebimentos de comissão'),
  ('creditor_commission_manage_permission', 'Comissão por credor', 'Definir a taxa de comissão de cada credor')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.slug = 'super-admin'
   AND p.slug IN ('payment_confirm_permission','payment_method_manage_permission','creditor_settlement_permission','creditor_commission_manage_permission')
ON CONFLICT DO NOTHING;
