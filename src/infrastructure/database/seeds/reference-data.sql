-- Dados de referência (idempotente: pode correr várias vezes)
INSERT INTO invoice_states (code, name) VALUES
  ('PENDING','Pendente'), ('IN_PROGRESS','Em curso'), ('IN_DISPUTE','Em disputa'),
  ('PAID','Liquidado'), ('PARTIALLY_PAID','Liquidado parcialmente'), ('CANCELLED','Cancelada'), ('OVERDUE','Vencida')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO process_states (code, name) VALUES
  ('REGISTERED','Registado'), ('ASSIGNED','Atribuído'), ('IN_PROGRESS','Em cobrança'), ('PENDING','Pendente'), ('CANCELLED','Cancelado'), ('FINISHED','Finalizado')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO currencies (name, code, symbol) VALUES
  ('Kwanza', 'AOA', 'Kz'), ('Dólar Americano', 'USD', '$'), ('Euro', 'EUR', '€')
ON CONFLICT (code) DO NOTHING;

INSERT INTO debtor_types (name, description, is_company) VALUES
  ('Empresa', 'Pessoa colectiva', true), ('Pessoa Física', 'Pessoa singular', false)
ON CONFLICT ((lower(name))) DO NOTHING;

INSERT INTO categories (name) VALUES ('Júnior'), ('Pleno'), ('Sénior')
ON CONFLICT ((lower(name))) DO NOTHING;

INSERT INTO contact_types (name) VALUES ('Chamada telefónica'), ('E-mail'), ('SMS'), ('Visita presencial')
ON CONFLICT ((lower(name))) DO NOTHING;

INSERT INTO roles (slug, name, description, is_manager) VALUES
  ('super-admin', 'super-admin', 'Administrador do sistema', false),
  ('gestor_role', 'Gestor', 'Gestor de carteira', true),
  ('agente_role', 'Agente', 'Agente de cobrança', false)
ON CONFLICT (slug) DO NOTHING;
