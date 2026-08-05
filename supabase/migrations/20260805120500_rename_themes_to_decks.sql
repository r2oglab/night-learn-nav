-- Rename themes table to decks and update card/revision foreign keys
BEGIN;

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_theme_id_fkey;
ALTER TABLE public.revisions DROP CONSTRAINT IF EXISTS revisions_theme_id_fkey;

ALTER TABLE public.themes RENAME TO public.decks;

ALTER TABLE public.decks RENAME COLUMN theme_id TO deck_id;

ALTER TABLE public.cards RENAME COLUMN theme_id TO deck_id;
ALTER TABLE public.cards
  ADD CONSTRAINT cards_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.decks(id) ON DELETE CASCADE;

ALTER TABLE public.revisions RENAME COLUMN theme_id TO deck_id;
ALTER TABLE public.revisions
  ADD CONSTRAINT revisions_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.decks(id) ON DELETE CASCADE;

ALTER INDEX IF EXISTS idx_cards_theme_id RENAME TO idx_cards_deck_id;
ALTER INDEX IF EXISTS idx_revisions_theme_id RENAME TO idx_revisions_deck_id;

DROP INDEX IF EXISTS themes_parent_id_idx;
CREATE INDEX IF NOT EXISTS decks_parent_id_idx ON public.decks(parent_id);

COMMIT;
