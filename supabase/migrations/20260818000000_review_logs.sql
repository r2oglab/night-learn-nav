-- Per-review history log — the base for "estatísticas de verdade" (retenção
-- por deck, cards mais errados, evolução no tempo). Nothing in the app
-- currently keeps this: `cards` only holds the *current* FSRS state, with a
-- single-level prev_state snapshot for undo, not a real history.
--
-- Append-only by design: authenticated users can INSERT and SELECT their own
-- rows, but not UPDATE or DELETE them — a review that happened, happened.
-- Deleting a card or deck cascades into its logs, so stats never reference a
-- card/deck that no longer exists.
--
-- Estudo livre never writes here: reviewCard is the only writer, and free
-- mode skips that call entirely, so every row is a real FSRS-scheduled
-- review.
CREATE TABLE public.review_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  deck_id uuid NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating IN (1, 2, 3, 4)),
  was_correct boolean NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.review_logs TO authenticated;
GRANT ALL ON public.review_logs TO service_role;

ALTER TABLE public.review_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own review logs" ON public.review_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own review logs" ON public.review_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX review_logs_user_id_idx ON public.review_logs (user_id);
CREATE INDEX review_logs_deck_id_idx ON public.review_logs (deck_id);
CREATE INDEX review_logs_card_id_idx ON public.review_logs (card_id);
CREATE INDEX review_logs_reviewed_at_idx ON public.review_logs (reviewed_at);