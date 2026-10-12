-- Estado inicial do processo: REGISTADO (a cobrança ainda não arrancou).
-- "Em cobrança" passa a ser o estado de quem já tem cobrança em curso.
INSERT INTO process_states (code, name) VALUES ('REGISTERED', 'Registado')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

UPDATE process_states SET name = 'Em cobrança' WHERE code = 'IN_PROGRESS';

-- Processos abertos que nunca tiveram contacto nem acordo voltam ao estado inicial,
-- para que os dados já existentes sigam a mesma regra de negócio.
UPDATE processes p
   SET process_state_id = (SELECT id FROM process_states WHERE code = 'REGISTERED'),
       updated_at = now()
 WHERE p.closed_at IS NULL
   AND p.contacts_count = 0
   AND p.process_state_id = (SELECT id FROM process_states WHERE code = 'IN_PROGRESS')
   AND NOT EXISTS (SELECT 1 FROM negotiation_processes np WHERE np.process_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM collection_ladder_executions e WHERE e.process_id = p.id);
