import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, Undo2, MoreVertical, CalendarClock, Sparkles, Keyboard } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Rating } from "ts-fsrs";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { reviewCard, undoReview, postponeCard } from "@/lib/cards.functions";
import { Input } from "@/components/ui/input";
import { compareAnswer, type DiffPart } from "@/lib/answer-diff";
import { explainCard } from "@/lib/ai.functions";
import { cn } from "@/lib/utils";
import { renderLiteMarkdown } from "@/lib/markdown-lite";
import {
  advanceLearningStep,
  startLearningStep,
  LEARNING_STEPS_MIN,
  RELEARNING_STEPS_MIN,
  type LearningStepState,
} from "@/lib/learning-steps";

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
  reps?: number | null;
  rootDeckName?: string;
  level1SubdeckName?: string | null;
  image_url?: string | null;
  occlusion_regions?: OcclusionRegion[] | null;
  occlusion_target_id?: string | null;
  card_type?: string | null;
  image_placement?: string | null;
  explanation?: string | null;
  tags?: string[] | null;
};

type DeckTally = { correct: number; incorrect: number };

const DIRECT_ON_ROOT = "__direct__";

export function ReviewSession({
  cards,
  onExit,
  onComplete,
  freeMode = false,
  readOnly = false,
  examMode = false,
}: {
  cards: Card[];
  onExit: () => void;
  onComplete?: () => void;
  freeMode?: boolean;
  /** Browse pergunta+resposta together, no grading, no FSRS — "folhear" a
   * deck before class instead of testing yourself. Implies freeMode. */
  readOnly?: boolean;
  /** Same no-FSRS mechanics as freeMode — caller passes both together —
   * just a different badge so a shuffled self-test doesn't look like a
   * regular free-study pass. */
  examMode?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(readOnly);
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [tally, setTally] = useState<Record<string, DeckTally>>({});
  const [subdeckTally, setSubdeckTally] = useState<Record<string, Record<string, DeckTally>>>({});
  // Anki-style learning steps: cards mid-steps live here, session-local —
  // see src/lib/learning-steps.ts for why the database is untouched while
  // a card is bouncing between these short delays.
  const [learningMap, setLearningMap] = useState<Map<string, LearningStepState>>(new Map());
  // Re-render every second while anything is pending, so a card whose
  // timer just elapsed gets picked up and the "volta em Xm" countdown (if
  // showing) stays live — this is the only reason this tick exists.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (learningMap.size === 0 || freeMode) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [learningMap.size, freeMode]);
  const [sessionCards] = useState(() => cards);
  const gradingRef = useRef(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const typeInputRef = useRef<HTMLInputElement>(null);
  const undo = useServerFn(undoReview);
  const postpone = useServerFn(postponeCard);
  const explain = useServerFn(explainCard);
  const [explanation, setExplanation] = useState<string | null>(
    () => cards[0]?.explanation ?? null,
  );
  const [explaining, setExplaining] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [gradeFlash, setGradeFlash] = useState<"correct" | "incorrect" | null>(null);

  async function handleExplain() {
    if (!current || explaining) return;
    setExplaining(true);
    try {
      const result = await explain({
        data: {
          card_id: current.id,
          pergunta: current.pergunta,
          resposta: current.resposta,
          ...(explanation ? { previous_explanation: explanation } : {}),
        },
      });
      setExplanation(result.explanation);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExplaining(false);
    }
  }
  // Which card the last grading applied to, so undo knows what to roll back
  // even though `index` has already moved on.
  const [lastGraded, setLastGraded] = useState<{
    id: string;
    deckName: string;
    subdeckName: string;
    wasCorrect: boolean;
    wasOverride: boolean;
  } | null>(null);
  const grade = useServerFn(reviewCard);
  const qc = useQueryClient();

  // If a learning-step card's timer has elapsed, it takes priority over
  // the normal queue position — this is what makes it "reappear" mid
  // session instead of only after the fixed queue is exhausted.
  const dueLearningCardId = (() => {
    if (freeMode || learningMap.size === 0) return null;
    const now = Date.now();
    let earliest: [string, LearningStepState] | null = null;
    for (const entry of learningMap) {
      const [, state] = entry;
      if (state.dueAt <= now && (!earliest || state.dueAt < earliest[1].dueAt)) earliest = entry;
    }
    return earliest ? earliest[0] : null;
  })();
  const normalCard = sessionCards[index];
  const current = dueLearningCardId
    ? (sessionCards.find((c) => c.id === dueLearningCardId) ?? normalCard)
    : normalCard;
  const isOverrideCard = !!dueLearningCardId && current?.id === dueLearningCardId;
  // Single source of truth for "explanation shown matches the card shown" —
  // every navigation path (grade, undo, postpone, read-only next/prev)
  // used to set this manually with sessionCards[someIndex], which broke
  // once "next card" could also be a learning-step override outside the
  // normal index. Syncing off current.id here covers every path at once.
  useEffect(() => {
    setExplanation(current?.explanation ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);
  const clozeMatch = current?.pergunta?.match(/\{\{c::(.*?)\}\}/);
  const isCloze = !!clozeMatch;
  const maskedQuestion = isCloze
    ? current!.pergunta.replace(/\{\{c::(.*?)\}\}/g, "___")
    : (current?.pergunta ?? "");
  const clozeFull = isCloze ? current!.pergunta.replace(/\{\{c::(.*?)\}\}/g, (_, g) => g) : null;

  const isTypeIn = current?.card_type === "digitar";
  // NULL/undefined predates this feature — those cards only ever showed
  // the image on front, so that stays the default for them.
  const imagePlacement = current?.image_placement ?? "frente";
  const showImageOnFront = imagePlacement === "frente" || imagePlacement === "ambos";
  const showImageOnBack = imagePlacement === "verso" || imagePlacement === "ambos";
  const comparison =
    isTypeIn && revealed && !readOnly ? compareAnswer(typedAnswer, current?.resposta ?? "") : null;

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

  /** Push the current card out N days and move on without grading it. */
  async function handlePostpone(days: number) {
    if (!current || loading) return;
    setLoading(true);
    try {
      await postpone({
        data: { id: current.id, days, tz_offset_minutes: new Date().getTimezoneOffset() },
      });
      void qc.invalidateQueries({ queryKey: ["cards"] });
      // Explicitly pushing the due date out supersedes any short-term
      // learning-step timer this card might have had running.
      setLearningMap((m) => {
        if (!m.has(current.id)) return m;
        const c = new Map(m);
        c.delete(current.id);
        return c;
      });
      setRevealed(false);
      setTypedAnswer("");
      if (!isOverrideCard) {
        const next = index + 1;
        setIndex(next);
        if (next >= sessionCards.length) setFinished(true);
      }
      toast.success(`Card adiado por ${days} dia(s)`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleUndo() {
    if (!lastGraded || loading) return;
    setLoading(true);
    try {
      await undo({ data: { id: lastGraded.id } });

      // Reverse the tally too, or the end-of-session summary would still
      // count a review the user just took back.
      const dec = (t: DeckTally) => ({
        correct: t.correct - (lastGraded.wasCorrect ? 1 : 0),
        incorrect: t.incorrect - (lastGraded.wasCorrect ? 0 : 1),
      });
      setTally((prev) => {
        const entry = prev[lastGraded.deckName];
        if (!entry) return prev;
        return { ...prev, [lastGraded.deckName]: dec(entry) };
      });
      setSubdeckTally((prev) => {
        const root = prev[lastGraded.deckName];
        const entry = root?.[lastGraded.subdeckName];
        if (!root || !entry) return prev;
        return {
          ...prev,
          [lastGraded.deckName]: { ...root, [lastGraded.subdeckName]: dec(entry) },
        };
      });

      void qc.invalidateQueries({ queryKey: ["cards"] });
      // A lapse commit (Review -> Relearning) starts a session-local
      // relearning run — undoing the commit should cancel that run too,
      // rather than leave the card bouncing on a timer for a lapse that
      // no longer happened.
      setLearningMap((m) => {
        if (!m.has(lastGraded.id)) return m;
        const c = new Map(m);
        c.delete(lastGraded.id);
        return c;
      });
      setFinished(false);
      setRevealed(false);
      setTypedAnswer("");
      // Only step the index back for a card graded at its normal queue
      // position — an override card (shown early because its learning
      // timer elapsed) never advanced the index in the first place.
      if (!lastGraded.wasOverride) {
        setIndex(Math.max(0, index - 1));
      }
      setLastGraded(null);
      toast.success("Avaliação desfeita");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleReadOnlyNext() {
    const next = index + 1;
    if (next >= sessionCards.length) {
      setFinished(true);
      return;
    }
    setIndex(next);
  }

  function handleReadOnlyPrev() {
    if (index === 0) return;
    setIndex(index - 1);
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
      const cardId = current.id;
      const now = Date.now();
      const tzOffset = new Date().getTimezoneOffset();
      const existingStep = learningMap.get(cardId);
      // Pending entries belonging to OTHER cards — untouched by anything
      // this press does, so they carry over into the "is the session
      // truly over" check at the end.
      const otherPendingCount = learningMap.size - (existingStep ? 1 : 0);
      // Whether a real FSRS commit happened this press — drives whether
      // the session tally/undo track it, same as every press did before
      // learning steps existed. Intermediate step presses (Errei/Difícil/
      // a non-graduating Bom) never reach the database at all.
      let didCommit = false;
      // Whether THIS card is still pending (mid-steps) after this press.
      let thisCardStillPending = false;

      if (freeMode) {
        // Estudo livre nunca toca a linha do card nem o agendamento do
        // FSRS, nem passa pela máquina de passos — sempre foi assim.
      } else if (existingStep) {
        // Already mid-steps (learning or relearning) — advance the local
        // machine. Only a NEW card's learning run needs a DB write on
        // graduation; a relearning run's real commit already happened
        // when the lapse itself was recorded, so graduating out of it is
        // silent — the long-term due FSRS set back then simply stands.
        const { next, graduated } = advanceLearningStep(existingStep, rating, now);
        if (graduated) {
          setLearningMap((m) => {
            const c = new Map(m);
            c.delete(cardId);
            return c;
          });
          if (existingStep.phase === "learning") {
            await grade({ data: { id: cardId, rating, tz_offset_minutes: tzOffset } });
            didCommit = true;
          }
        } else if (next) {
          setLearningMap((m) => new Map(m).set(cardId, next));
          thisCardStillPending = true;
        }
      } else {
        const isNewCard = (current.reps ?? 0) === 0;
        if (isNewCard) {
          // A virgin card's very first rating decides where it lands in
          // the step list — starting from step 0 and applying the rating
          // right away covers Again/Hard/Good/Easy correctly without a
          // separate "just entered" case.
          const virgin: LearningStepState = { phase: "learning", stepIndex: 0, dueAt: now };
          const { next, graduated } = advanceLearningStep(virgin, rating, now);
          if (graduated) {
            await grade({ data: { id: cardId, rating, tz_offset_minutes: tzOffset } });
            didCommit = true;
          } else if (next) {
            setLearningMap((m) => new Map(m).set(cardId, next));
            thisCardStillPending = true;
          }
        } else {
          // A card that's already been reviewed before, first encounter
          // this session — a normal FSRS review, exactly as it always was.
          await grade({ data: { id: cardId, rating, tz_offset_minutes: tzOffset } });
          didCommit = true;
          if (rating === Rating.Again) {
            // The lapse itself is already committed above — this just
            // starts a short in-session re-drill on top of it.
            setLearningMap((m) => new Map(m).set(cardId, startLearningStep("relearning", now)));
            thisCardStillPending = true;
          }
        }
      }

      if (!freeMode && didCommit) {
        void qc.invalidateQueries({ queryKey: ["cards"] });
        void qc.invalidateQueries({ queryKey: ["decks"] });
      }

      const isCorrect = rating !== Rating.Again;
      setGradeFlash(isCorrect ? "correct" : "incorrect");
      setTimeout(() => setGradeFlash(null), 500);

      // Tally only a real commit (or every press in freeMode, unchanged) —
      // an intermediate step press shows the flash feedback above but
      // doesn't count the same card twice in the session summary.
      if (freeMode || didCommit) {
        const deckName = current.rootDeckName ?? "(sem deck)";
        const subdeckName = current.level1SubdeckName ?? DIRECT_ON_ROOT;
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
        if (!freeMode) {
          setLastGraded({
            id: cardId,
            deckName,
            subdeckName,
            wasCorrect: isCorrect,
            wasOverride: isOverrideCard,
          });
        }
      }

      setRevealed(false);
      setTypedAnswer("");
      // An override card never occupied an index slot, so grading it never
      // advances the normal queue — whatever's due next (another override,
      // or the queue's current position) resolves on its own next render.
      const effectiveNextIndex = isOverrideCard ? index : index + 1;
      if (!isOverrideCard) {
        setIndex(effectiveNextIndex);
      }
      const queueExhausted = effectiveNextIndex >= sessionCards.length;
      const anyPendingLeft = otherPendingCount > 0 || thisCardStillPending;
      if (queueExhausted && !anyPendingLeft) {
        setFinished(true);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      gradingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (e.key === "Escape" && showShortcuts) {
        e.preventDefault();
        setShowShortcuts(false);
        return;
      }
      if (finished || loading || !current) return;
      if (readOnly) {
        if (e.key === "Enter" || e.code === "Space" || e.key === "ArrowRight") {
          e.preventDefault();
          handleReadOnlyNext();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          handleReadOnlyPrev();
        }
        return;
      }
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
  }, [revealed, loading, finished, current, showShortcuts, readOnly, index, sessionCards]);

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

  // Normal queue is exhausted but a learning-step card hasn't hit its
  // timer yet — rather than show nothing, name the wait and count it down
  // (the tick effect above re-renders this every second).
  if (!current && !finished && learningMap.size > 0) {
    const soonest = [...learningMap.values()].reduce((min, s) => Math.min(min, s.dueAt), Infinity);
    const secondsLeft = Math.max(0, Math.ceil((soonest - Date.now()) / 1000));
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="mb-2 text-lg font-semibold">
            Aguardando {learningMap.size} card(s) voltarem...
          </h2>
          <p className="text-sm text-muted-foreground">Próximo em {secondsLeft}s</p>
        </div>
      </div>
    );
  }

  if (finished) {
    if (readOnly) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4">
          <div className="w-full max-w-md rounded-lg bg-card p-4 shadow-lg sm:p-6">
            <h2 className="text-lg font-semibold">Leitura concluída</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Você releu {sessionCards.length} card(s). Nada foi alterado no agendamento.
            </p>
            <div className="mt-6 flex justify-end">
              <Button onClick={() => onComplete?.()}>Concluir</Button>
            </div>
          </div>
        </div>
      );
    }
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
            {freeMode &&
              (examMode
                ? " · prova simulada, agendamento não foi alterado"
                : " · estudo livre, agendamento não foi alterado")}
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

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium" title={name}>
                        {name}
                      </p>
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
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-2 sm:p-4">
        <div className="relative max-h-full w-full max-w-3xl overflow-y-auto rounded-lg bg-card p-4 shadow-lg sm:p-6">
          <div className="flex flex-col items-stretch gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium text-muted-foreground">
                  {index + 1}/{sessionCards.length}
                </div>
                {readOnly ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500">
                    Leitura
                  </span>
                ) : examMode ? (
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs text-violet-400">
                    Prova simulada
                  </span>
                ) : (
                  freeMode && (
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-400">
                      Estudo livre
                    </span>
                  )
                )}
                {!freeMode &&
                  current &&
                  learningMap.has(current.id) &&
                  (() => {
                    const step = learningMap.get(current.id);
                    if (!step) return null;
                    const steps =
                      step.phase === "learning" ? LEARNING_STEPS_MIN : RELEARNING_STEPS_MIN;
                    return (
                      <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-xs text-orange-400">
                        {step.phase === "learning" ? "Aprendendo" : "Reaprendendo"} — passo{" "}
                        {step.stepIndex + 1}/{steps.length}
                      </span>
                    );
                  })()}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="ml-auto size-8">
                      <MoreVertical className="size-4" />
                      <span className="sr-only">Opções da sessão</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setShowShortcuts(true)}>
                      <Keyboard className="mr-2 size-4" /> Atalhos de teclado
                    </DropdownMenuItem>
                    {!freeMode && !readOnly && (
                      <>
                        <DropdownMenuItem
                          disabled={!lastGraded || loading}
                          onSelect={() => void handleUndo()}
                        >
                          <Undo2 className="mr-2 size-4" /> Desfazer
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={loading}
                          onSelect={() => void handlePostpone(1)}
                        >
                          <CalendarClock className="mr-2 size-4" /> Adiar 1 dia
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={loading}
                          onSelect={() => void handlePostpone(7)}
                        >
                          <CalendarClock className="mr-2 size-4" /> Adiar 7 dias
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem onSelect={() => onExit()}>
                      <X className="mr-2 size-4" /> Sair da sessão
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${(index / sessionCards.length) * 100}%` }}
                />
              </div>
            </div>

            <div
              key={current?.id}
              className={cn(
                "animate-fade-in-up rounded-lg border border-border p-4 sm:p-6 break-words",
                gradeFlash === "correct" && "animate-grade-flash-correct",
                gradeFlash === "incorrect" && "animate-grade-flash-incorrect",
              )}
            >
              {current?.tags && current.tags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {current.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {current?.image_url && current?.occlusion_target_id ? (
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
                      <div
                        className="text-base"
                        dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(current.resposta) }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-4 text-sm text-muted-foreground">Pergunta</div>
                  <div
                    className="text-base"
                    dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(maskedQuestion) }}
                  />
                  {current?.image_url && showImageOnFront && (
                    <img
                      src={current.image_url}
                      alt=""
                      className="mx-auto mt-4 block max-h-80 w-auto rounded-lg"
                    />
                  )}

                  {isTypeIn && !readOnly && (
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
                            <span className="mr-2 text-xs text-muted-foreground">
                              Você digitou:
                            </span>
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
                        <div
                          className="text-base"
                          dangerouslySetInnerHTML={{
                            __html: renderLiteMarkdown(
                              isCloze
                                ? (clozeFull ?? current?.resposta ?? "")
                                : (current?.resposta ?? ""),
                            ),
                          }}
                        />
                      )}
                      {current?.image_url && showImageOnBack && (
                        <img
                          src={current.image_url}
                          alt=""
                          className="mx-auto mt-4 block max-h-80 w-auto rounded-lg"
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {revealed && (
              <div className="grid gap-2">
                {explanation ? (
                  <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Sparkles className="size-3.5" /> Explicação
                      </div>
                      <button
                        type="button"
                        disabled={explaining}
                        onClick={() => void handleExplain()}
                        className="shrink-0 text-xs text-sky-400 underline underline-offset-2 hover:text-sky-300 disabled:opacity-50"
                      >
                        {explaining ? "Gerando..." : "Explicar de outro jeito"}
                      </button>
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">{explanation}</div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={explaining}
                    onClick={() => void handleExplain()}
                  >
                    <Sparkles className="size-3.5" />
                    <span className="ml-1.5">
                      {explaining ? "Explicando..." : "Explicar assunto"}
                    </span>
                  </Button>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              {readOnly ? (
                <div className="flex w-full gap-2">
                  <Button
                    variant="outline"
                    className="h-12 flex-1 sm:h-9 sm:flex-none"
                    disabled={index === 0}
                    onClick={handleReadOnlyPrev}
                  >
                    Anterior
                  </Button>
                  <Button className="h-12 flex-1 sm:h-9 sm:flex-none" onClick={handleReadOnlyNext}>
                    Próximo
                  </Button>
                </div>
              ) : !revealed ? (
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

      {showShortcuts && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-card p-4 shadow-lg sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Atalhos de teclado</h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setShowShortcuts(false)}
              >
                <X className="size-4" />
                <span className="sr-only">Fechar</span>
              </Button>
            </div>
            <dl className="space-y-2 text-sm">
              {[
                ["Espaço / Enter", "Revelar resposta"],
                ["1", "Errei"],
                ["2", "Difícil"],
                ["3", "Bom"],
                ["4", "Fácil"],
                ["?", "Abrir/fechar este painel"],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {key}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </>
  );
}

export default ReviewSession;