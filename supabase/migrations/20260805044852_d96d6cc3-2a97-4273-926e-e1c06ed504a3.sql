ALTER TABLE public.themes ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.themes(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS themes_parent_id_idx ON public.themes(parent_id);

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_goal integer NOT NULL DEFAULT 20,
  desired_retention double precision NOT NULL DEFAULT 0.9,
  last_review_date date,
  streak integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their settings" ON public.user_settings;
CREATE POLICY "Users can manage their settings" ON public.user_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);