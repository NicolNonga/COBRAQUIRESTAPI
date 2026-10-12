-- =====================================================================
-- Transactional Outbox + Inbox
--  outbox_messages: eventos gravados NA MESMA transacção da mudança de negócio
--                   (nunca há "gravou mas não notificou" nem "notificou mas fez rollback").
--  inbox_messages : registo de (mensagem, handler) já processados → cada handler
--                   executa no máximo uma vez com sucesso por mensagem (idempotência do consumidor).
-- =====================================================================
CREATE TABLE outbox_messages (
  id               uuid PRIMARY KEY,
  type             varchar(100) NOT NULL,
  payload          jsonb,                       -- NULL depois de enviado se for sensível
  encrypted        boolean NOT NULL DEFAULT false,
  dedup_key        varchar(200),               -- evita enfileirar o mesmo evento duas vezes
  status           varchar(20) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PROCESSING','SENT','DEAD')),
  attempts         int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     int NOT NULL DEFAULT 10 CHECK (max_attempts > 0),
  available_at     timestamptz NOT NULL DEFAULT now(),  -- próximo instante de tentativa (backoff)
  locked_by        varchar(100),
  locked_until     timestamptz,                -- lease: se o worker morrer, outro retoma após expirar
  last_error       text,
  request_id       varchar(64),                -- correlação com o pedido que originou o evento
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE UNIQUE INDEX ux_outbox_dedup_key ON outbox_messages (dedup_key) WHERE dedup_key IS NOT NULL;
-- fila de trabalho: só as linhas elegíveis, ordenadas por disponibilidade
CREATE INDEX ix_outbox_ready ON outbox_messages (available_at, id) WHERE status = 'PENDING';
CREATE INDEX ix_outbox_stuck ON outbox_messages (locked_until) WHERE status = 'PROCESSING';
CREATE INDEX ix_outbox_dead ON outbox_messages (created_at DESC) WHERE status = 'DEAD';
CREATE INDEX ix_outbox_sent_processed ON outbox_messages (processed_at) WHERE status = 'SENT';
CREATE INDEX ix_outbox_type_created ON outbox_messages (type, created_at DESC);

CREATE TABLE inbox_messages (
  message_id    uuid NOT NULL,
  handler       varchar(100) NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, handler)
);
CREATE INDEX ix_inbox_processed_at ON inbox_messages (processed_at);

-- acorda os dispatchers imediatamente após o COMMIT (o polling fica como rede de segurança)
CREATE FUNCTION outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox_new', '');
  RETURN NULL;
END $$;
CREATE TRIGGER trg_outbox_notify AFTER INSERT ON outbox_messages
  FOR EACH STATEMENT EXECUTE FUNCTION outbox_notify();

-- permissão de administração da outbox, atribuída ao super-admin
INSERT INTO permissions (slug, name, description)
VALUES ('outbox_manage_permission', 'Gerir outbox', 'Consultar e reprocessar mensagens da outbox')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.slug = 'super-admin' AND p.slug = 'outbox_manage_permission'
ON CONFLICT DO NOTHING;
