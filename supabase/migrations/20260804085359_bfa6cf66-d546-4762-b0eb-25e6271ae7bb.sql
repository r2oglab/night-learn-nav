CREATE TABLE public.themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.themes TO authenticated;
GRANT ALL ON public.themes TO service_role;

ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own themes" ON public.themes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own themes" ON public.themes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own themes" ON public.themes
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own themes" ON public.themes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_themes_updated_at
BEFORE UPDATE ON public.themes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.revisions
  ADD COLUMN theme_id uuid REFERENCES public.themes(id) ON DELETE CASCADE,
  ADD COLUMN rating integer;

CREATE INDEX idx_revisions_theme_id ON public.revisions(theme_id);
CREATE INDEX idx_themes_user_due ON public.themes(user_id, due);