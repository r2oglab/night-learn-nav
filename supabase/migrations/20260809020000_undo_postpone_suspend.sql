-- Undo / postpone / suspend support.
-- prev_state holds the FSRS fields as they were before the most recent
-- grading, which is what makes a one-level undo possible without keeping a
-- full review log. NULL = nothing to undo.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS prev_state jsonb,
  ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;

-- Suspended cards are skipped by the review queue, so the queue query
-- filters on this constantly.
CREATE INDEX IF NOT EXISTS cards_suspended_idx ON public.cards (suspended);