-- Tema claro/escuro e cor de destaque customizável. NULL nos dois = visual
-- de hoje sem nenhuma mudança (escuro, teal) — só muda pra quem abrir
-- Configurações e escolher algo.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS theme text,
  ADD COLUMN IF NOT EXISTS accent_hue integer;