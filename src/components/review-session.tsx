import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, Play } from "lucide-react";
import { Rating } from "ts-fsrs";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { reviewCard } from "@/lib/cards.functions";

type Card = {
  id: string;
  pergunta: string;
  resposta: string;
  due?: string;
};

export function ReviewSession({
  cards,
  onExit,
  onComplete,
}: {
  cards: Card[];
  onExit: () => void;
  onComplete?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const grade = useServerFn(reviewCard);
  const qc = useQueryClient();

  const current = cards[index];
  const clozeMatch = current?.pergunta?.match(/\{\{c::(.*?)\}\}/);
  const isCloze = !!clozeMatch;
  const maskedQuestion = isCloze ? current!.pergunta.replace(/\{\{c::(.*?)\}\}/g, '___') : (current?.pergunta ?? '');
  const clozeFull = isCloze ? current!.pergunta.replace(/\{\{c::(.*?)\}\}/g, (_, g) => g) : null;

  async function handleRating(rating: number) {
    if (!current) return;
    setLoading(true);
    try {
      await grade({ data: { id: current.id, rating } });
      void qc.invalidateQueries({ queryKey: ["cards"] });
      void qc.invalidateQueries({ queryKey: ["decks"] });
      setRevealed(false);
      const next = index + 1;
      if (next >= cards.length) {
        toast.success("Fila finalizada");
        onComplete?.();
      } else {
        setIndex(next);
      }
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="mb-4 text-xl font-semibold">Tudo revisado</h2>
          <Button onClick={onExit}>Voltar</Button>
        </div>
      </div>
    );
  }

  if (index >= cards.length) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="mb-4 text-xl font-semibold">Tudo revisado</h2>
          <Button onClick={onExit}>Voltar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-3xl rounded-lg bg-card p-6 shadow-lg">
        <button
          onClick={onExit}
          className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-md p-2 text-sm text-muted-foreground"
        >
          <X className="size-4" />
          <span className="sr-only">Sair</span>
        </button>

        <div className="flex flex-col items-stretch gap-6">
          <div className="flex items-center gap-3">
            <Play className="size-6" />
            <h2 className="text-lg font-semibold">Sessão de Revisão</h2>
            <div className="ml-auto text-sm text-muted-foreground">{index + 1}/{cards.length}</div>
          </div>

          <div className="rounded-lg border border-border p-6">
            <div className="mb-4 text-sm text-muted-foreground">Pergunta</div>
            <div className="text-base">{maskedQuestion}</div>

            {revealed && (
              <div className="mt-6">
                <div className="mb-2 text-sm text-muted-foreground">Resposta</div>
                <div className="text-base">{isCloze ? (clozeFull ?? current?.resposta) : current?.resposta}</div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!revealed ? (
              <Button onClick={() => setRevealed(true)}>Revelar resposta</Button>
            ) : (
              <div className="flex w-full gap-2">
                <Button disabled={loading} onClick={() => void handleRating(Rating.Again)} variant="destructive">Errei</Button>
                <Button disabled={loading} onClick={() => void handleRating(Rating.Hard)}>Difícil</Button>
                <Button disabled={loading} onClick={() => void handleRating(Rating.Good)}>Bom</Button>
                <Button disabled={loading} onClick={() => void handleRating(Rating.Easy)}>Fácil</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReviewSession;
