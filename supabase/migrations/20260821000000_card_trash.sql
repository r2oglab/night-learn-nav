-- Lixeira temporária: "excluir" passa a marcar deleted_at em vez de apagar
-- de verdade. listCards filtra deleted_at IS NULL, então cards na lixeira
-- somem de todo o resto do app (revisão, dashboard, busca) sem precisar
-- lembrar de filtrar em cada lugar que consulta cards.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS cards_deleted_at_idx ON public.cards (deleted_at);