-- Manual deck reordering + pin-to-top. sort_order is nullable (NULL falls
-- back to name order); it's only populated once the person actually
-- reorders siblings for the first time, via a single batch write of
-- sequential values covering that whole sibling group.
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS sort_order integer,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;