-- =====================================================================
-- Régua MASTER (política de cobrança) — única e geral, definida pelo administrador.
-- Fixa os limites que TODAS as réguas dos comerciais/gestores (filhas) têm de cumprir.
-- =====================================================================
CREATE TABLE collection_policies (
  id                               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- uma só política no sistema
  name                             varchar(120) NOT NULL,
  description                      text,
  version                          int NOT NULL DEFAULT 1,
  -- dias de tolerância depois do vencimento antes de a factura entrar em cobrança (processo)
  grace_days                       int NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 365),
  -- duração máxima da cobrança de um processo (nenhuma etapa pode passar deste dia)
  max_collection_days              int NOT NULL CHECK (max_collection_days BETWEEN 1 AND 3650),
  max_steps                        int NOT NULL CHECK (max_steps BETWEEN 1 AND 50),
  -- limite de contactos registados por processo (NULL = sem limite)
  max_contacts_per_process         int CHECK (max_contacts_per_process IS NULL OR max_contacts_per_process BETWEEN 1 AND 1000),
  -- canais permitidos nas mensagens ao devedor (EMAIL e/ou SMS; EMAIL_SMS exige os dois)
  allowed_debtor_channels          text[] NOT NULL DEFAULT '{}' CHECK (allowed_debtor_channels <@ ARRAY['EMAIL','SMS']::text[]),
  -- intervalo mínimo entre duas mensagens ao devedor na mesma régua
  min_days_between_debtor_messages int NOT NULL DEFAULT 0 CHECK (min_days_between_debtor_messages BETWEEN 0 AND 365),
  updated_by_id                    int REFERENCES users(id) ON DELETE SET NULL,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);

-- regra por tipo de acção: janela de dias, prazo máximo de cumprimento e se é obrigatória.
-- Tipo de acção SEM regra = não permitido nas réguas filhas.
CREATE TABLE collection_policy_step_rules (
  id                    serial PRIMARY KEY,
  policy_id             smallint NOT NULL REFERENCES collection_policies(id) ON DELETE CASCADE,
  action_type           varchar(30) NOT NULL CHECK (action_type IN ('CONTACT_REMINDER','NEGOTIATION_SUGGESTION','ESCALATION','CUSTOM_ALERT')),
  min_day               int NOT NULL CHECK (min_day BETWEEN 0 AND 3650),
  max_day               int NOT NULL CHECK (max_day BETWEEN 0 AND 3650),
  max_fulfillment_days  int CHECK (max_fulfillment_days IS NULL OR max_fulfillment_days BETWEEN 0 AND 365),
  is_required           boolean NOT NULL DEFAULT false,
  CONSTRAINT ck_policy_rule_window CHECK (min_day <= max_day),
  CONSTRAINT ux_policy_rule_action UNIQUE (policy_id, action_type)
);

-- política inicial permissiva (o administrador aperta): as réguas existentes continuam válidas
INSERT INTO collection_policies (name, description, grace_days, max_collection_days, max_steps, max_contacts_per_process,
                                 allowed_debtor_channels, min_days_between_debtor_messages)
VALUES ('Régua master', 'Limites que todas as réguas de cobrança têm de cumprir.', 0, 365, 50, NULL, '{EMAIL,SMS}', 0);

INSERT INTO collection_policy_step_rules (policy_id, action_type, min_day, max_day, max_fulfillment_days, is_required)
SELECT 1, a, 0, 365, NULL, false
  FROM unnest(ARRAY['CONTACT_REMINDER','NEGOTIATION_SUGGESTION','ESCALATION','CUSTOM_ALERT']) AS a;

-- ----------------------------- réguas filhas -----------------------------
ALTER TABLE collection_ladders
  ADD COLUMN policy_version     int,                               -- versão da master contra a qual foi validada
  ADD COLUMN policy_compliant   boolean NOT NULL DEFAULT true,     -- false = deixou de cumprir a master → o motor ignora-a
  ADD COLUMN policy_violations  jsonb;
UPDATE collection_ladders SET policy_version = 1;

-- processos que ultrapassaram a duração máxima de cobrança (avisa-se uma só vez)
ALTER TABLE processes ADD COLUMN policy_limit_notified_at timestamptz;
