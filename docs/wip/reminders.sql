-- =====================================================================
-- Lembretes internos de vencimento (agente responsável + gestor, via notificações/socket).
-- reminder_deliveries garante que cada lembrete (alvo + desfasamento) sai UMA vez,
-- mesmo que o job corra várias vezes ou em várias réplicas.
-- =====================================================================
CREATE TABLE reminder_deliveries (
  id                 bigserial PRIMARY KEY,
  target_type        varchar(20) NOT NULL CHECK (target_type IN ('INVOICE','INSTALLMENT')),
  target_id          int NOT NULL,
  offset_days        int NOT NULL,               -- -3 = 3 dias antes, 0 = no dia, 7 = 7 dias depois
  recipient_user_id  int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_reminder_deliveries_target ON reminder_deliveries (target_type, target_id, offset_days);
CREATE INDEX ix_reminder_deliveries_created ON reminder_deliveries (created_at);
CREATE INDEX ix_negotiation_installments_due ON negotiation_installments (due_date) WHERE status IN ('PENDING','OVERDUE');

INSERT INTO permissions (slug, name, description)
VALUES ('reminders_run_permission', 'Executar lembretes', 'Disparar manualmente o job de lembretes de vencimento')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.slug = 'super-admin' AND p.slug = 'reminders_run_permission'
ON CONFLICT DO NOTHING;
