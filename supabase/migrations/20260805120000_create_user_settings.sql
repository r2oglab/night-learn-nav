-- Create user_settings table and RLS for per-user access
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_goal integer DEFAULT 20,
  desired_retention double precision NOT NULL DEFAULT 0.9,
  last_review_date date,
  streak integer DEFAULT 0
);

-- Enable Row Level Security and allow authenticated users to manage their own row
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their settings" ON public.user_settings
  USING (auth.uid() = user_id::text)
  WITH CHECK (auth.uid() = user_id::text);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;

-- Ensure an index on user_id (PK already exists) and a convenience view if needed
-- No-op
