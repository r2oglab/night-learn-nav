CREATE TABLE public.revisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  theme TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('done','overdue','pending')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.revisions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revisions TO authenticated;
GRANT ALL ON public.revisions TO service_role;

ALTER TABLE public.revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revisions are viewable by everyone"
  ON public.revisions FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert revisions"
  ON public.revisions FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update revisions"
  ON public.revisions FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete revisions"
  ON public.revisions FOR DELETE TO authenticated
  USING (true);

CREATE INDEX revisions_scheduled_date_idx ON public.revisions (scheduled_date);

INSERT INTO public.revisions (theme, scheduled_date, status) VALUES
  ('Anatomia', '2026-08-02', 'done'),
  ('Inglês', '2026-08-03', 'done'),
  ('História', '2026-08-03', 'overdue'),
  ('Química', '2026-08-05', 'done'),
  ('Física', '2026-08-08', 'overdue'),
  ('Redação', '2026-08-08', 'done'),
  ('Biologia', '2026-08-08', 'done'),
  ('Geografia', '2026-08-11', 'done'),
  ('Matemática', '2026-08-12', 'overdue'),
  ('Inglês', '2026-08-12', 'pending'),
  ('Filosofia', '2026-08-14', 'pending'),
  ('Anatomia', '2026-08-17', 'pending'),
  ('Química', '2026-08-17', 'pending'),
  ('História', '2026-08-17', 'pending'),
  ('Literatura', '2026-08-17', 'pending'),
  ('Física', '2026-08-19', 'pending'),
  ('Sociologia', '2026-08-22', 'pending'),
  ('Biologia', '2026-08-22', 'pending'),
  ('Redação', '2026-08-25', 'pending'),
  ('Matemática', '2026-08-28', 'pending'),
  ('Inglês', '2026-08-28', 'pending');