-- =====================================================================
-- Índices de pesquisa/filtros
--  * pg_trgm + GIN → `ILIKE '%texto%'` usa índice (sem full scan)
--  * unaccent (IMMUTABLE wrapper) → pesquisa "joao" encontra "João"
--  * B-tree para os filtros de intervalo/igualdade mais usados
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() não é IMMUTABLE → wrapper para poder ser usado em índices de expressão
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- pesquisa livre (trigram, sem acentos)
CREATE INDEX ix_debtors_name_trgm        ON debtors        USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX ix_debtors_nif_trgm         ON debtors        USING gin (nif gin_trgm_ops);
CREATE INDEX ix_debtors_email_trgm       ON debtors        USING gin (email gin_trgm_ops);
CREATE INDEX ix_organizations_name_trgm  ON organizations  USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX ix_users_full_name_trgm     ON users          USING gin (f_unaccent(full_name) gin_trgm_ops);
CREATE INDEX ix_users_email_trgm         ON users          USING gin (email gin_trgm_ops);
CREATE INDEX ix_invoices_reference_trgm  ON invoices       USING gin (reference_number gin_trgm_ops);

-- filtros por intervalo / igualdade
CREATE INDEX ix_invoices_due_date        ON invoices (due_date);
CREATE INDEX ix_invoices_issue_date      ON invoices (issue_date);
CREATE INDEX ix_invoices_debtor_due      ON invoices (debtor_id, due_date);
CREATE INDEX ix_negotiations_effective   ON negotiations (effective_date);
CREATE INDEX ix_processes_open_created   ON processes (created_at DESC) WHERE closed_at IS NULL;
