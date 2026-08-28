-- Dashboard configurável — só esconder/mostrar por ora (sem reordenar,
-- baixo ROI pro esforço extra num dashboard de 4 widgets fixos). Array
-- vazio = tudo visível, comportamento de hoje sem mudança nenhuma.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS hidden_widgets text[] NOT NULL DEFAULT '{}';