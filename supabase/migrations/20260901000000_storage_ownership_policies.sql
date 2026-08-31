-- Corrige achado CRÍTICO do scanner de segurança do Lovable: as políticas
-- de storage para 'avatars' e 'card-images' só checavam bucket_id, então
-- qualquer usuário autenticado podia sobrescrever ou apagar arquivo de
-- outro usuário (nunca conferiam dono do caminho).
--
-- 'card-images' nunca teve nada identificando o dono no nome do arquivo
-- (era só um UUID solto) — por isso o código também passou a subir os
-- arquivos como "user_id/uuid.ext" a partir de agora; esta migração já
-- assume esse formato nas políticas novas. Arquivos enviados ANTES desta
-- mudança (sem essa pasta) continuam visíveis pra sempre — a política de
-- leitura pública não muda — só não podem mais ser apagados/substituídos
-- pelas rotinas normais do app; isso é aceitável (a limpeza de imagem
-- órfã já era "melhor esforço", nunca crítica).
--
-- 'avatars' já subia como "user_id-timestamp.ext" (hífen, não pasta) —
-- manter compatível com o que já existe, só trocando a checagem de
-- "bucket certo" pra "bucket certo E nome começa com o meu user_id".

DROP POLICY IF EXISTS "Authenticated users can upload card images" ON storage.objects;
CREATE POLICY "Users can upload their own card images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'card-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Authenticated users can update card images" ON storage.objects;
CREATE POLICY "Users can update their own card images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'card-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Authenticated users can delete card images" ON storage.objects;
CREATE POLICY "Users can delete their own card images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'card-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- "Public can view card images" (SELECT) fica como está — leitura
-- pública é o comportamento pretendido e não é parte do achado.

DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND name LIKE (auth.uid()::text || '-%'));

DROP POLICY IF EXISTS "Authenticated users can update avatars" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND name LIKE (auth.uid()::text || '-%'));

DROP POLICY IF EXISTS "Authenticated users can delete avatars" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND name LIKE (auth.uid()::text || '-%'));

-- "Public can view avatars" (SELECT) fica como está, mesmo motivo.