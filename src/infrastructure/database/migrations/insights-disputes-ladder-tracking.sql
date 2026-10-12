-- =====================================================================
-- 1) Painel de gestão  2) Resolução de facturas em disputa  3) Cumprimento dos passos da régua
-- =====================================================================

-- ---------------------------------------------------------------- 1) painel
-- "recuperado no período" sem filtro de credor e "posto em cobrança no período"
CREATE INDEX IF NOT EXISTS ix_payments_confirmed_paid_on ON payments (paid_on) INCLUDE (amount_base, organization_id, negotiation_id) WHERE status = 'CONFIRMED';
CREATE INDEX IF NOT EXISTS ix_processes_start_date ON processes (start_date);

-- ---------------------------------------------------------------- 2) disputas
-- Uma factura sai da cobrança "Em disputa" com motivo; a resolução fica registada (nunca se apaga):
--   UPHELD    procedente para o credor → volta à cobrança (o job de geração junta-a ao processo do devedor)
--   CANCELLED o devedor tinha razão     → factura Cancelada, sai da dívida
--   ADJUSTED  valor corrigido           → novo valor (o original fica aqui) e volta à cobrança
CREATE TABLE invoice_disputes (
  id                bigserial PRIMARY KEY,
  invoice_id        int NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  process_id        int REFERENCES processes(id) ON DELETE SET NULL,      -- processo de onde a factura saiu
  reason            text NOT NULL,
  status            varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  outcome           varchar(10) CHECK (outcome IN ('UPHELD','CANCELLED','ADJUSTED')),
  original_amount   numeric(18,2) NOT NULL,
  adjusted_amount   numeric(18,2) CHECK (adjusted_amount > 0),
  resolution_notes  text,
  opened_by_id      int REFERENCES users(id) ON DELETE RESTRICT,         -- NULL só nas disputas migradas
  opened_at         timestamptz NOT NULL DEFAULT now(),
  resolved_by_id    int REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at       timestamptz,
  version           int NOT NULL DEFAULT 1,
  CONSTRAINT ck_invoice_disputes_state CHECK (
        (status = 'OPEN' AND outcome IS NULL AND resolved_at IS NULL AND resolved_by_id IS NULL)
     OR (status = 'RESOLVED' AND outcome IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by_id IS NOT NULL AND resolution_notes IS NOT NULL)),
  CONSTRAINT ck_invoice_disputes_adjusted CHECK ((outcome = 'ADJUSTED') = (adjusted_amount IS NOT NULL)),
  CONSTRAINT ck_invoice_disputes_adjusted_differs CHECK (adjusted_amount IS NULL OR adjusted_amount <> original_amount)
);
-- no máximo UMA disputa aberta por factura (abrir duas vezes em paralelo → a segunda falha)
CREATE UNIQUE INDEX ux_invoice_disputes_open ON invoice_disputes (invoice_id) WHERE status = 'OPEN';
CREATE INDEX ix_invoice_disputes_status ON invoice_disputes (status, opened_at);
CREATE INDEX ix_invoice_disputes_invoice ON invoice_disputes (invoice_id, opened_at DESC);
CREATE TRIGGER trg_invoice_disputes_no_delete BEFORE DELETE ON invoice_disputes FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- facturas que já estavam "Em disputa" antes deste registo
INSERT INTO invoice_disputes (invoice_id, reason, original_amount, opened_at)
SELECT i.id, 'Em disputa antes do registo de disputas (migrado)', i.amount, i.updated_at
  FROM invoices i JOIN invoice_states s ON s.id = i.invoice_state_id
 WHERE s.code = 'IN_DISPUTE';

-- ---------------------------------------------------------------- 3) cumprimento da régua
-- Cada passo pode exigir acção: `fulfillment_days` = prazo (dias) para o agente registar um contacto no processo.
-- NULL = passo só informativo (não é acompanhado).
ALTER TABLE collection_ladder_steps
  ADD COLUMN fulfillment_days int CONSTRAINT ck_ladder_steps_fulfillment_days CHECK (fulfillment_days BETWEEN 0 AND 365);

-- NOT_TRACKED → (PENDING → FULFILLED | OVERDUE → FULFILLED tarde) ; VOID = processo fechado antes do prazo
ALTER TABLE collection_ladder_executions
  ADD COLUMN agent_id             int REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN status               varchar(15) NOT NULL DEFAULT 'NOT_TRACKED'
                                  CONSTRAINT ck_ladder_exec_status CHECK (status IN ('NOT_TRACKED','PENDING','FULFILLED','OVERDUE','VOID')),
  ADD COLUMN due_on               date,
  ADD COLUMN fulfilled_at         timestamptz,
  ADD COLUMN fulfilled_contact_id int REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN fulfilled_late       boolean,
  ADD COLUMN escalated_at         timestamptz,
  ADD CONSTRAINT ck_ladder_exec_tracking CHECK (status = 'NOT_TRACKED' OR due_on IS NOT NULL),
  ADD CONSTRAINT ck_ladder_exec_fulfilled CHECK (status <> 'FULFILLED' OR (fulfilled_at IS NOT NULL AND fulfilled_late IS NOT NULL));

UPDATE collection_ladder_executions e SET agent_id = pa.user_id FROM process_assignments pa WHERE pa.process_id = e.process_id;

-- job de acompanhamento: só olha para o que está em aberto
CREATE INDEX ix_ladder_exec_open ON collection_ladder_executions (due_on) WHERE status IN ('PENDING','OVERDUE');
-- tarefas/cumprimento por agente
CREATE INDEX ix_ladder_exec_agent ON collection_ladder_executions (agent_id, executed_at DESC) WHERE status <> 'NOT_TRACKED';

-- ---------------------------------------------------------------- permissões
INSERT INTO permissions (slug, name, description) VALUES
  ('dashboard_view_all_permission', 'Painel: ver tudo', 'Ver o painel de todos os agentes e credores (sem permissão: agente vê os seus, gestor a sua equipa)'),
  ('invoice_dispute_resolve_permission', 'Resolver disputas', 'Resolver facturas em disputa (procedente, anulada, valor corrigido)')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.slug = 'super-admin' AND p.slug IN ('dashboard_view_all_permission','invoice_dispute_resolve_permission')
ON CONFLICT DO NOTHING;
