-- "Type in the answer" cards (Anki's Basic (type in the answer)).
-- NULL means a regular card, so existing rows keep working untouched.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS card_type text;