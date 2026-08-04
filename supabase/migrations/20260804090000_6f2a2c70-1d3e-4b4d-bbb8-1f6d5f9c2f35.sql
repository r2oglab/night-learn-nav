-- Create a new cards table for individual spaced repetition cards
CREATE TABLE public.cards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  theme_id uuid NOT NULL REFERENCES public.themes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  pergunta text NOT NULL,
  resposta text NOT NULL,
  due date NOT NULL DEFAULT CURRENT_DATE,
  stability double precision NOT NULL DEFAULT 0,
  difficulty double precision NOT NULL DEFAULT 0,
  elapsed_days integer NOT NULL DEFAULT 0,
  scheduled_days integer NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  state integer NOT NULL DEFAULT 0,
  last_review timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cards TO authenticated;
GRANT ALL ON public.cards TO service_role;

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cards" ON public.cards
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own cards" ON public.cards
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.themes t
      WHERE t.id = public.cards.theme_id AND t.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can update their own cards" ON public.cards
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own cards" ON public.cards
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_cards_theme_id ON public.cards(theme_id);

CREATE TRIGGER update_cards_updated_at
BEFORE UPDATE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Simplify themes table so it keeps only grouping information
ALTER TABLE public.themes
  DROP COLUMN due,
  DROP COLUMN stability,
  DROP COLUMN difficulty,
  DROP COLUMN elapsed_days,
  DROP COLUMN scheduled_days,
  DROP COLUMN reps,
  DROP COLUMN lapses,
  DROP COLUMN state,
  DROP COLUMN last_review,
  DROP COLUMN updated_at;

-- Remove the redundant theme text column from revisions
ALTER TABLE public.revisions
  DROP COLUMN theme;

-- Restrict view access to revisions so users only see revisions for their own themes
DROP POLICY IF EXISTS "Revisions are viewable by everyone" ON public.revisions;
REVOKE SELECT ON public.revisions FROM anon;

CREATE POLICY "Users can view revisions for their own themes" ON public.revisions
  FOR SELECT TO authenticated
  USING (
    theme_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.themes t
      WHERE t.id = public.revisions.theme_id
        AND t.user_id = auth.uid()
    )
  );