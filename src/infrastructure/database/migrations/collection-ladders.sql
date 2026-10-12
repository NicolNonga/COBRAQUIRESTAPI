-- =====================================================================
-- Régua de cobrança dinâmica: cada comercial (agente) cria e edita a SUA régua.
-- O backend só fornece o motor; nenhuma régua vem pré-definida.
-- Dia da régua = dias desde a entrada do processo em cobrança (processes.start_date).
-- =====================================================================
CREATE TABLE collection_ladders (
  id             serial PRIMARY KEY,
  owner_user_id  int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           varchar(120) NOT NULL,
  description    text,
  is_active      boolean NOT NULL DEFAULT false,
  version        int NOT NULL DEFAULT 1,            -- lock optimista + rasto de alterações
  archived_at    timestamptz,                      -- réguas usadas não se apagam: arquivam-se
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_collection_ladders_archived_inactive CHECK (archived_at IS NULL OR NOT is_active)
);
-- um comercial tem no máximo UMA régua activa (é essa que corre nos seus processos)
CREATE UNIQUE INDEX ux_collection_ladders_active_owner ON collection_ladders (owner_user_id) WHERE is_active;
CREATE INDEX ix_collection_ladders_owner ON collection_ladders (owner_user_id, created_at DESC) WHERE archived_at IS NULL;

CREATE TABLE collection_ladder_steps (
  id                serial PRIMARY KEY,
  ladder_id         int NOT NULL REFERENCES collection_ladders(id) ON DELETE CASCADE,
  day_offset        int NOT NULL CHECK (day_offset BETWEEN 0 AND 3650),
  action_type       varchar(30) NOT NULL CHECK (action_type IN ('CONTACT_REMINDER','NEGOTIATION_SUGGESTION','ESCALATION','CUSTOM_ALERT')),
  recipients        varchar(10) NOT NULL CHECK (recipients IN ('AGENT','MANAGER','BOTH')),
  priority          varchar(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  title             varchar(150) NOT NULL,
  message_template  text NOT NULL,                  -- {{debtorName}}, {{processId}}, {{day}}, {{totalAmount}}, {{invoicesCount}}
  removed_at        timestamptz,                    -- remoção lógica: execuções antigas continuam a referenciar o passo
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- um único passo vivo por dia em cada régua
CREATE UNIQUE INDEX ux_collection_ladder_steps_day ON collection_ladder_steps (ladder_id, day_offset) WHERE removed_at IS NULL;

-- execuções: garante que cada passo corre UMA vez por processo (job idempotente, N réplicas)
CREATE TABLE collection_ladder_executions (
  id              bigserial PRIMARY KEY,
  process_id      int NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  step_id         int NOT NULL REFERENCES collection_ladder_steps(id) ON DELETE CASCADE,
  ladder_id       int NOT NULL REFERENCES collection_ladders(id) ON DELETE CASCADE,
  ladder_version  int NOT NULL,
  process_day     int NOT NULL,
  executed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_collection_ladder_executions ON collection_ladder_executions (process_id, step_id);
CREATE INDEX ix_collection_ladder_executions_ladder ON collection_ladder_executions (ladder_id, executed_at DESC);

-- motor: processos abertos por responsável
CREATE INDEX ix_processes_open_start ON processes (start_date) WHERE closed_at IS NULL;

INSERT INTO permissions (slug, name, description)
VALUES ('collection_ladder_run_permission', 'Executar régua de cobrança', 'Disparar manualmente o motor da régua de cobrança')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.slug = 'super-admin' AND p.slug = 'collection_ladder_run_permission'
ON CONFLICT DO NOTHING;
