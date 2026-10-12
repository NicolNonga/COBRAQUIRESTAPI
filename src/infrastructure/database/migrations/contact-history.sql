-- =====================================================================
-- Histórico de contactos: N contactos por processo (antes: 1).
-- Resumo desnormalizado no processo para filtros rápidos
-- ("sem contacto há X dias", "último resultado") sem agregar o histórico.
-- =====================================================================
DROP INDEX IF EXISTS ux_contacts_process;

-- momento real do contacto (antes só havia a data, sem hora)
ALTER TABLE contacts ADD COLUMN contacted_at timestamptz;
UPDATE contacts SET contacted_at = COALESCE(contact_date::timestamptz, created_at);
ALTER TABLE contacts ALTER COLUMN contacted_at SET NOT NULL, ALTER COLUMN contacted_at SET DEFAULT now();

-- histórico de um processo por ordem cronológica + produtividade por agente
CREATE INDEX ix_contacts_process_contacted ON contacts (process_id, contacted_at DESC);
CREATE INDEX ix_contacts_user_contacted ON contacts (user_id, contacted_at DESC);

ALTER TABLE processes
  ADD COLUMN last_contact_at     timestamptz,
  ADD COLUMN last_contact_status varchar(30),
  ADD COLUMN contacts_count      int NOT NULL DEFAULT 0 CHECK (contacts_count >= 0);

-- backfill a partir dos contactos existentes
UPDATE processes p SET
  contacts_count = s.n, last_contact_at = s.last_at, last_contact_status = s.last_status
FROM (
  SELECT DISTINCT ON (process_id) process_id,
         count(*) OVER (PARTITION BY process_id) AS n,
         contacted_at AS last_at, status AS last_status
    FROM contacts ORDER BY process_id, contacted_at DESC, id DESC
) s WHERE s.process_id = p.id;

-- "processos abertos sem contacto há X dias" (NULL = nunca contactado → primeiro)
CREATE INDEX ix_processes_open_last_contact ON processes (last_contact_at NULLS FIRST) WHERE closed_at IS NULL;
