-- Data de prova por deck/módulo — usada pra priorizar a fila de revisão por
-- proximidade. Um subdeck sem exam_date herda a do ancestral mais próximo
-- que tiver uma (resolvido no código, não no banco).
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS exam_date date;

-- Limite diário de cards NOVOS, separado do limite total que já existia —
-- mesmo padrão (por deck e global), mesma semântica de NULL = sem limite.
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS daily_new_limit integer;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS daily_new_limit integer;