-- Complemento da 20260901000000: aquela migração travou no meio (a parte
-- de card-images já tinha rodado com sucesso numa tentativa anterior, e a
-- 2ª tentativa quebrou em "policy already exists" antes de chegar em
-- avatars). Este arquivo cobre só o que ainda falta, e cada DROP agora
-- remove tanto o nome antigo quanto o novo — pode rodar de novo no futuro
-- sem travar, mesmo que já tenha rodado antes.

DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND name LIKE (auth.uid()::text || '-%'));

DROP POLICY IF EXISTS "Authenticated users can update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND name LIKE (auth.uid()::text || '-%'));

DROP POLICY IF EXISTS "Authenticated users can delete avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND name LIKE (auth.uid()::text || '-%'));

-- "Public can view avatars" e "Public can view card images" (SELECT)
-- ficam como estão — o próprio scanner marcou como "Info", não "Warning",
-- confirmando que leitura pública nesses dois buckets é intencional.