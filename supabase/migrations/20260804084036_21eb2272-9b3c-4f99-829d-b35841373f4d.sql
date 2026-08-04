DROP POLICY IF EXISTS "Authenticated users can insert revisions" ON public.revisions;
DROP POLICY IF EXISTS "Authenticated users can update revisions" ON public.revisions;
DROP POLICY IF EXISTS "Authenticated users can delete revisions" ON public.revisions;
REVOKE INSERT, UPDATE, DELETE ON public.revisions FROM authenticated;