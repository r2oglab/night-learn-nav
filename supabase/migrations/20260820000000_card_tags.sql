-- Free-form tags per card — orthogonal to deck, for things like "objetivo de
-- PBL", "prioridade de prova", "tipo de conteúdo". Filterable in Flashcards
-- and, later, a building block for CSV auto-tag-by-filename and "cards
-- relacionados".
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- GIN index so "cards with tag X" stays fast as the deck grows.
CREATE INDEX IF NOT EXISTS cards_tags_idx ON public.cards USING GIN (tags);