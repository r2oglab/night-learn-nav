-- Where an attached (non-occlusion) image shows during review: front, back,
-- or both. NULL means "front", matching the only behaviour that existed
-- before this column — so existing image cards keep working unchanged.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS image_placement text;