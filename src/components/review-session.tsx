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
  rootDeckName?: string;
};

type DeckTally = { correct: number; incorrect: number };

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
  const [finished, setFinished] = useState(false);
  const [tally, setTally] = useState<Record<string, DeckTally>>({});
  // Freeze the list once, at session start. The `cards` prop comes from a
  // live query in the parent that gets invalidated after every rating (so
  // the app-wide card list stays fresh), which would otherwise shrink out
  // from under this component mid-session and desync `index`/length.
  const [sessionCards] = useState(() => cards);
  const grade = useServerFn(reviewCard);
  const qc = useQueryClient();

  const current = sessionCards[index];
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

      const isCorrect = rating !== Rating.Again;
      const deckName = current.rootDeckName ?? "(sem deck)";
      setTally((prev) => {
        const entry = prev[deckName] ?? { correct: 0, incorrect: 0 };
        return {
          ...prev,
          [deckName]: {
            correct: entry.correct + (isCorrect ? 1 : 0),
            incorrect: entry.incorrect + (isCorrect ? 0 : 1),
          },
        };
      });

      setRevealed(false);
      const next = index + 1;
      setIndex(next);
      if (next >= sessionCards.length) {
        setFinished(true);
      }
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!sessionCards || sessionCards.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="mb-4 text-xl font-semibold">Tudo revisado</h2>
          <Button onClick={onExit}>Voltar</Button>
        </div>
      </div>
    );
  }

  if (finished) {
    const deckNames = Object.keys(tally).sort(
      (a, b) => tally[b].correct + tally[b].incorrect - (tally[a].correct + tally[a].incorrect),
    );
    const totalCorrect = deckNames.reduce((sum, name) => sum + tally[name].correct, 0);
    const totalCards = deckNames.reduce((sum, name) => sum + tally[name].correct + tally[name].incorrect, 0);
    const r = 32;
    const circumference = 2 * Math.PI * r;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4">
        <div className="w-full max-w-2xl rounded-lg bg-card p-6 shadow-lg">
          <h2 className="text-lg font-semibold">Sessão finalizada</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCorrect}/{totalCards} acertos no total
          </p>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {deckNames.map((name) => {
              const { correct, incorrect } = tally[name];
              const total = correct + incorrect;
              const correctDash = total > 0 ? (correct / total) * circumference : 0;
              return (
                <div
                  key={name}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center"
                >
                  <svg width={80} height={80} viewBox="0 0 80 80">
                    <circle cx={40} cy={40} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={12} />
                    {correct > 0 && (
                      <circle
                        cx={40}
                        cy={40}
                        r={r}
                        fill="none"
                        stroke="#10B981"
                        strokeWidth={12}
                        strokeDasharray={`${correctDash} ${circumference - correctDash}`}
                        transform="rotate(-90 40 40)"
                      />
                    )}
                    {incorrect > 0 && (
                      <circle
                        cx={40}
                        cy={40}
                        r={r}
                        fill="none"
                        stroke="#EF4444"
                        strokeWidth={12}
                        strokeDasharray={`${circumference - correctDash} ${correctDash}`}
                        strokeDashoffset={-correctDash}
                        transform="rotate(-90 40 40)"
                      />
                    )}
                  </svg>
                  <p className="text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">{correct}/{total} acertos</p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex justify-end">
            <Button onClick={() => onComplete?.()}>Concluir</Button>
          </div>
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
            <div className="ml-auto text-sm text-muted-foreground">{index + 1}/{sessionCards.length}</div>
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