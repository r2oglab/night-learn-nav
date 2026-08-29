-- Decks também precisam de soft-delete. Sem isso, excluir um deck aciona o
-- ON DELETE CASCADE de cards.deck_id, que apaga de vez QUALQUER card daquele
-- deck — inclusive os que já estavam na lixeira, já que cascade não olha
-- pra deleted_at, só pra chave estrangeira. Isso furava a lixeira por trás.
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS decks_deleted_at_idx ON public.decks (deleted_at);