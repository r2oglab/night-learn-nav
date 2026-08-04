CREATE POLICY "Users can log revisions for their own themes" ON public.revisions
  FOR INSERT TO authenticated
  WITH CHECK (
    theme_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.themes t
      WHERE t.id = revisions.theme_id AND t.user_id = auth.uid()
    )
  );

GRANT INSERT ON public.revisions TO authenticated;