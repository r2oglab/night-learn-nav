-- Nota pessoal por card — mnemônico ou lembrete separado de pergunta/
-- resposta, nunca mostrado durante a revisão (só em Flashcards).
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS note text;