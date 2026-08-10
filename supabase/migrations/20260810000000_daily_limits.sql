-- Daily review limits.
-- NULL means "no limit", which is the behaviour everything had until now.
--
-- decks.daily_limit applies to the deck AND everything under it, so a cap on
-- a parent constrains its subdecks too.
-- user_settings.daily_limit is a single ceiling across all decks combined.
-- It is deliberately separate from daily_goal, which is only a target used
-- to colour the heatmap and must not silently start capping reviews.
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS daily_limit integer;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS daily_limit integer;