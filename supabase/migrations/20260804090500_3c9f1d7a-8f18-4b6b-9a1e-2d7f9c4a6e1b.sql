-- Migration: add parent_id to themes for deck hierarchy
-- A theme with parent_id NULL is a root deck.
BEGIN;

ALTER TABLE public.themes
  ADD COLUMN parent_id uuid REFERENCES public.themes(id) ON DELETE CASCADE;

CREATE INDEX themes_parent_id_idx ON public.themes(parent_id);

COMMIT;
