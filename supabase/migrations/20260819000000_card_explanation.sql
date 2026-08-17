-- Persist the AI explanation ("Explicar assunto") on the card itself, so it's
-- generated once and reused — today it's regenerated from scratch every time
-- the review screen mounts, which is slower and burns AI calls for no reason.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS explanation text;