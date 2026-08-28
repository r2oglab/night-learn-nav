-- Cards relacionados — link manual não-direcional entre dois cards
-- (ex: dois conceitos do mesmo PBL). Par sempre normalizado (card_a_id <
-- card_b_id) pra impedir duplicata A-B/B-A e permitir UNIQUE de verdade.
-- Ao contrário dos outros logs desta sessão, aqui o usuário pode desfazer
-- (desvincular é uma ação normal, não histórico).
CREATE TABLE public.card_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  card_a_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  card_b_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_links_distinct CHECK (card_a_id <> card_b_id),
  CONSTRAINT card_links_ordered CHECK (card_a_id < card_b_id),
  CONSTRAINT card_links_unique UNIQUE (card_a_id, card_b_id)
);

GRANT SELECT, INSERT, DELETE ON public.card_links TO authenticated;
GRANT ALL ON public.card_links TO service_role;

ALTER TABLE public.card_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own card links" ON public.card_links
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own card links" ON public.card_links
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own card links" ON public.card_links
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX card_links_card_a_idx ON public.card_links (card_a_id);
CREATE INDEX card_links_card_b_idx ON public.card_links (card_b_id);