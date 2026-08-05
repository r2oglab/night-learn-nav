-- Re-add updated_at to decks (dropped by mistake in 20260804090000), which the
-- update_themes_updated_at trigger still writes to on every UPDATE.
ALTER TABLE public.decks
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
