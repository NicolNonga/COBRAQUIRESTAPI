-- =====================================================================
-- Ciclo de vida da negociação: aprovação, quebra e renegociação (aditivo).
--   PENDING_APPROVAL ─► ACTIVE ─► COMPLETED
--          │              ├─► CANCELLED
--          └─► REJECTED   ├─► BROKEN ─► RENEGOTIATED
--                         └─► RENEGOTIATED
-- `debt_amount` = saldo de abertura (soma das facturas, ou saldo do acordo anterior na renegociação).
-- =====================================================================
ALTER TABLE negotiations DROP CONSTRAINT IF EXISTS negotiations_status_check;
ALTER TABLE negotiations ADD CONSTRAINT ck_negotiations_status
  CHECK (status IN ('PENDING_APPROVAL','ACTIVE','REJECTED','CANCELLED','COMPLETED','BROKEN','RENEGOTIATED'));

ALTER TABLE negotiations
  ADD COLUMN previous_negotiation_id int REFERENCES negotiations(id) ON DELETE RESTRICT,
  ADD COLUMN authorized_by_id        int REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at             timestamptz,
  ADD COLUMN rejected_at             timestamptz,
  ADD COLUMN rejection_reason        text,
  ADD COLUMN started_at              timestamptz,
  ADD COLUMN completed_at            timestamptz,
  ADD COLUMN broken_at               timestamptz,
  ADD COLUMN broken_by_id            int REFERENCES users(id) ON DELETE SET NULL,  -- NULL = quebra automática
  ADD COLUMN break_reason            text,
  ADD COLUMN renegotiated_at         timestamptz;

-- acordos existentes já estão em vigor
UPDATE negotiations SET started_at = created_at WHERE status = 'ACTIVE' AND started_at IS NULL;

-- quatro olhos: quem negoceia não aprova
ALTER TABLE negotiations ADD CONSTRAINT ck_negotiations_four_eyes
  CHECK (authorized_by_id IS NULL OR created_by_id IS NULL OR authorized_by_id <> created_by_id);
-- coerência estado ↔ datas (o histórico nunca fica "a meio")
ALTER TABLE negotiations ADD CONSTRAINT ck_negotiations_state_fields CHECK (
      (status <> 'BROKEN'       OR (broken_at IS NOT NULL AND break_reason IS NOT NULL))
  AND (status <> 'REJECTED'     OR (rejected_at IS NOT NULL AND rejection_reason IS NOT NULL))
  AND (status <> 'RENEGOTIATED' OR renegotiated_at IS NOT NULL)
  AND (status <> 'ACTIVE'       OR started_at IS NOT NULL)
);
-- um acordo só pode ser renegociado UMA vez (dois pedidos simultâneos → o segundo falha)
CREATE UNIQUE INDEX ux_negotiations_previous ON negotiations (previous_negotiation_id) WHERE previous_negotiation_id IS NOT NULL;
-- fila de aprovação e job de quebra
CREATE INDEX ix_negotiations_pending_approval ON negotiations (created_at) WHERE status = 'PENDING_APPROVAL';
CREATE INDEX ix_negotiations_active ON negotiations (id) WHERE status = 'ACTIVE';

INSERT INTO permissions (slug, name, description) VALUES
  ('negotiation_approve_permission', 'Aprovar negociações', 'Aprovar/rejeitar negociações acima do limite de desconto'),
  ('negotiation_break_permission', 'Quebrar negociações', 'Declarar manualmente a quebra de um acordo')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.slug = 'super-admin' AND p.slug IN ('negotiation_approve_permission','negotiation_break_permission')
ON CONFLICT DO NOTHING;
