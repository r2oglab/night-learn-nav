-- Arquivar deck — diferente de excluir: módulo que já passou mas quer
-- manter, sem aparecer na lista do dia a dia nem contar pra fila de
-- revisão/Dashboard. Reusa o campo suspended que os cards já têm — arquivar
-- um deck suspende todos os cards da subárvore de uma vez, e toda consulta
-- de "cards ativos" já ignora suspended, então nada mais precisa mudar.
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;