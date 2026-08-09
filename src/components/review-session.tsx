import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, Play } from "lucide-react";
import { Rating } from "ts-fsrs";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { reviewCard } from "@/lib/cards.functions";
import { Input } from "@/components/ui/input";
import { compareAnswer, type DiffPart } from "@/lib/answer-diff";

export type OcclusionRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | undefined;
};

type Card = {
  id: string;
  pergunta: string;
  resposta: string;
  due?: string;
  rootDeckName?: string;
  level1SubdeckName?: string | null;
  image_url?: string | null;
  occlusion_regions?: OcclusionRegion[] | null;
  occlusion_target_id?: string | null;
  card_type?: string | null;
};

type DeckTally = { correct: number; incorrect: number };

const DIRECT_ON_ROOT = "__direct__";

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
  const [subdeckTally, setSubdeckTally] = useState<Record<string, Record<string, DeckTally>>>({});
  const [sessionCards] = useState(() => cards);
  const gradingRef = useRef(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const typeInputRef = useRef<HTMLInputElement>(null);
  const grade = useServerFn(reviewCard);
  const qc = useQueryClient();

  const current = sessionCards[index];
  const clozeMatch = current?.pergunta?.match(/\{\{c::(.*?)\}\}/);
  const isCloze = !!clozeMatch;
  const maskedQuestion = isCloze
    ? current!.pergunta.replace(/\{\{c::(.*?)\}\}/g, "___")
    : (current?.pergunta ?? "");
  const clozeFull = isCloze ? current!.pergunta.replace(/\{\{c::(.*?)\}\}/g, (_, g) => g) : null;

  const isTypeIn = current?.card_type === "digitar";
  const comparison =
    isTypeIn && revealed ? compareAnswer(typedAnswer, current?.resposta ?? "") : null;

  function renderDiff(parts: DiffPart[]) {
    return parts.map((part, i) => (
      <span
        key={i}
        className={
          part.kind === "ok"
            ? "text-emerald-400"
            : part.kind === "missing"
              ? "rounded bg-amber-500/30 text-amber-300 underline"
              : "rounded bg-red-500/30 text-red-300 line-through"
        }
      >
        {part.text}
      </span>
    ));
  }

  async function handleRating(rating: number) {
    if (!current) return;
    // `loading` is React state, so it doesn't flip until the next render —
    // two fast keypresses can both get past a `loading` check and grade two
    // cards from one intent. This ref flips synchronously and closes that gap.
    if (gradingRef.current) return;
    gradingRef.current = true;
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

      const subdeckName = current.level1SubdeckName ?? DIRECT_ON_ROOT;
      setSubdeckTally((prev) => {
        const root = prev[deckName] ?? {};
        const entry = root[subdeckName] ?? { correct: 0, incorrect: 0 };
        return {
          ...prev,
          [deckName]: {
            ...root,
            [subdeckName]: {
              correct: entry.correct + (isCorrect ? 1 : 0),
              incorrect: entry.incorrect + (isCorrect ? 0 : 1),
            },
          },
        };
      });

      setRevealed(false);
      setTypedAnswer("");
      const next = index + 1;
      setIndex(next);
      if (next >= sessionCards.length) {
        setFinished(true);
      }
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      gradingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (finished || loading || !current) return;
      if (!revealed) {
        // On type-in cards the answer box owns Space, so only Enter reveals.
        if (e.key === "Enter" || (e.code === "Space" && current.card_type !== "digitar")) {
          e.preventDefault();
          setRevealed(true);
        }
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        void handleRating(Rating.Again);
      } else if (e.key === "2") {
        e.preventDefault();
        void handleRating(Rating.Hard);
      } else if (e.key === "3") {
        e.preventDefault();
        void handleRating(Rating.Good);
      } else if (e.key === "4") {
        e.preventDefault();
        void handleRating(Rating.Easy);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [revealed, loading, finished, current]);

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
    // Keys come from the objects themselves, so lookups always hit — but
    // TypeScript can't prove that, and an explicit fallback is safer than
    // a non-null assertion if the shape ever changes.
    const EMPTY_TALLY: DeckTally = { correct: 0, incorrect: 0 };
    const tallyOf = (name: string): DeckTally => tally[name] ?? EMPTY_TALLY;

    const deckNames = Object.keys(tally).sort(
      (a, b) =>
        tallyOf(b).correct + tallyOf(b).incorrect - (tallyOf(a).correct + tallyOf(a).incorrect),
    );
    const totalCorrect = deckNames.reduce((sum, name) => sum + tallyOf(name).correct, 0);
    const totalCards = deckNames.reduce(
      (sum, name) => sum + tallyOf(name).correct + tallyOf(name).incorrect,
      0,
    );
    const r = 32;
    const circumference = 2 * Math.PI * r;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4">
        <div className="w-full max-w-2xl rounded-lg bg-card p-4 shadow-lg sm:p-6">
          <h2 className="text-lg font-semibold">Sessão finalizada</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCorrect}/{totalCards} acertos no total
          </p>

          <div className="mt-6 space-y-4">
            {deckNames.map((name) => {
              const { correct, incorrect } = tallyOf(name);
              const total = correct + incorrect;
              const correctDash = total > 0 ? (correct / total) * circumference : 0;
              const subdecks = subdeckTally[name] ?? {};
              const subdeckNames = Object.keys(subdecks).sort((a, b) => {
                if (a === DIRECT_ON_ROOT) return 1;
                if (b === DIRECT_ON_ROOT) return -1;
                const sa = subdecks[a] ?? EMPTY_TALLY;
                const sb = subdecks[b] ?? EMPTY_TALLY;
                return sb.correct + sb.incorrect - (sa.correct + sa.incorrect);
              });
              return (
                <div
                  key={name}
                  className="flex items-start gap-4 rounded-xl border border-border p-4"
                >
                  <svg width={70} height={70} viewBox="0 0 80 80" className="shrink-0">
                    <circle
                      cx={40}
                      cy={40}
                      r={r}
                      fill="none"
                      stroke="hsl(var(--muted))"
                      strokeWidth={12}
                    />
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

                  <div className="flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{name}</p>
                      <p className="shrink-0 text-xs text-muted-foreground">
                        {correct}/{total} acertos
                      </p>
                    </div>

                    {subdeckNames.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {subdeckNames.map((subName) => {
                          const { correct: sc, incorrect: si } = subdecks[subName] ?? EMPTY_TALLY;
                          const stotal = sc + si;
                          const pct = stotal > 0 ? Math.round((sc / stotal) * 100) : 0;
                          return (
                            <div key={subName} className="flex items-center gap-2 text-xs">
                              <span
                                className="w-28 shrink-0 truncate text-muted-foreground"
                                title={subName === DIRECT_ON_ROOT ? name : subName}
                              >
                                {subName === DIRECT_ON_ROOT ? name : subName}
                              </span>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-emerald-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="w-10 shrink-0 text-right text-muted-foreground">
                                {sc}/{stotal}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-2 sm:p-4">
      <div className="relative max-h-full w-full max-w-3xl overflow-y-auto rounded-lg bg-card p-4 shadow-lg sm:p-6">
        <div className="flex flex-col items-stretch gap-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onExit}>
              <X className="size-4" /> Sair
            </Button>
            <Play className="hidden size-6 sm:block" />
            <h2 className="hidden text-lg font-semibold sm:block">Sessão de Revisão</h2>
            <div className="ml-auto text-sm text-muted-foreground">
              {index + 1}/{sessionCards.length}
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 sm:p-6">
            {current?.image_url ? (
              <div className="mx-auto max-w-xl">
                <div className="relative w-full overflow-hidden rounded-lg">
                  <img src={current.image_url} alt="" className="block w-full" />
                  {(current.occlusion_regions ?? []).map((region) => {
                    const isTarget = region.id === current.occlusion_target_id;
                    const stillHidden = !(revealed && isTarget);
                    if (!stillHidden) return null;
                    return (
                      <div
                        key={region.id}
                        className={`absolute border-2 ${isTarget ? "border-sky-600 bg-sky-500" : "border-amber-600 bg-amber-400"}`}
                        style={{
                          left: `${region.x}%`,
                          top: `${region.y}%`,
                          width: `${region.width}%`,
                          height: `${region.height}%`,
                        }}
                      />
                    );
                  })}
                </div>
                {revealed && current.resposta && (
                  <div className="mt-4">
                    <div className="mb-1 text-sm text-muted-foreground">Resposta</div>
                    <div className="text-base">{current.resposta}</div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="mb-4 text-sm text-muted-foreground">Pergunta</div>
                <div className="text-base">{maskedQuestion}</div>

                {isTypeIn && (
                  <div className="mt-4">
                    <Input
                      ref={typeInputRef}
                      autoFocus
                      value={typedAnswer}
                      onChange={(e) => setTypedAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !revealed) {
                          e.preventDefault();
                          setRevealed(true);
                        }
                      }}
                      disabled={revealed}
                      placeholder="Digite a resposta e aperte Enter"
                    />
                  </div>
                )}

                {revealed && (
                  <div className="mt-6">
                    <div className="mb-2 text-sm text-muted-foreground">Resposta</div>
                    {comparison ? (
                      <div className="grid gap-2 text-base">
                        <div>
                          <span className="mr-2 text-xs text-muted-foreground">Você digitou:</span>
                          {typedAnswer.trim() === "" ? (
                            <span className="text-muted-foreground">(nada)</span>
                          ) : (
                            renderDiff(comparison.typed)
                          )}
                        </div>
                        <div>
                          <span className="mr-2 text-xs text-muted-foreground">Correta:</span>
                          {renderDiff(comparison.expected)}
                        </div>
                        {comparison.correct && (
                          <div className="text-xs text-emerald-400">Resposta correta</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-base">
                        {isCloze ? (clozeFull ?? current?.resposta) : current?.resposta}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!revealed ? (
              <Button className="h-12 w-full sm:h-10 sm:w-auto" onClick={() => setRevealed(true)}>
                Revelar resposta
              </Button>
            ) : (
              <div className="grid w-full grid-cols-2 gap-2 sm:flex">
                <Button
                  className="h-12 w-full sm:h-9 sm:w-auto"
                  disabled={loading}
                  onClick={() => void handleRating(Rating.Again)}
                  variant="destructive"
                >
                  Errei
                </Button>
                <Button
                  className="h-12 w-full sm:h-9 sm:w-auto"
                  disabled={loading}
                  onClick={() => void handleRating(Rating.Hard)}
                >
                  Difícil
                </Button>
                <Button
                  className="h-12 w-full sm:h-9 sm:w-auto"
                  disabled={loading}
                  onClick={() => void handleRating(Rating.Good)}
                >
                  Bom
                </Button>
                <Button
                  className="h-12 w-full sm:h-9 sm:w-auto"
                  disabled={loading}
                  onClick={() => void handleRating(Rating.Easy)}
                >
                  Fácil
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReviewSession;