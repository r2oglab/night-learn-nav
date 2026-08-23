-- Escala geral da interface — como quase todo espaçamento e tipografia do
-- Tailwind é baseado em rem, ajustar o font-size da raiz escala densidade E
-- tamanho de fonte juntos, sem precisar reescrever cada componente. NULL =
-- 100% (comportamento atual, sem mudança nenhuma pra quem nunca mexer nisso).
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS ui_scale integer;