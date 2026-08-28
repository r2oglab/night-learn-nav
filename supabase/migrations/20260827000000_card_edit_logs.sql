-- Histórico de edições de pergunta/resposta — o que mudou e quando, pra
-- quando você corrige um erro depois de já ter estudado errado. Append-only
-- (INSERT/SELECT só), cascata ao apagar o card. Só pergunta/resposta —
-- tags, nota e suspensão não entram aqui, não é o tipo de "conteúdo que
-- você estudou errado".
CREATE TABLE public.card_edit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  previous_pergunta text NOT NULL,
  previous_resposta text NOT NULL,
  new_pergunta text NOT NULL,
  new_resposta text NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.card_edit_logs TO authenticated;
GRANT ALL ON public.card_edit_logs TO service_role;

ALTER TABLE public.card_edit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own card edit logs" ON public.card_edit_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own card edit logs" ON public.card_edit_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX card_edit_logs_card_id_idx ON public.card_edit_logs (card_id);