-- Image occlusion support: new columns on cards, plus a public storage
-- bucket for the uploaded images.
--
-- NOTE: this migration was applied manually via the SQL editor before the
-- file itself was committed, so every statement here is written to be safe
-- to re-run against a database that already has these objects.

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS occlusion_regions jsonb,
  ADD COLUMN IF NOT EXISTS occlusion_target_id text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('card-images', 'card-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can upload card images" ON storage.objects;
CREATE POLICY "Authenticated users can upload card images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'card-images');

DROP POLICY IF EXISTS "Authenticated users can update card images" ON storage.objects;
CREATE POLICY "Authenticated users can update card images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'card-images');

DROP POLICY IF EXISTS "Authenticated users can delete card images" ON storage.objects;
CREATE POLICY "Authenticated users can delete card images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'card-images');

DROP POLICY IF EXISTS "Public can view card images" ON storage.objects;
CREATE POLICY "Public can view card images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'card-images');