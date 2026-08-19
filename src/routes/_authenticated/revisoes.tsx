import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, ChevronDown, ChevronRight, Loader2, Play } from "lucide-react";
import { isLeech } from "@/lib/leech";
import { useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { listCards } from "@/lib/cards.functions";
import { listDecks } from "@/lib/decks.functions";
import { compareDecks } from "@/lib/deck-tree";
import { getUserSettings } from "@/lib/user_settings.functions";
import { applyDailyLimits } from "@/lib/daily-limits";
import { capitalizeFirst, cn } from "@/lib/utils";
import ReviewSession, { type OcclusionRegion } from "@/components/review-session";

export const Route = createFileRoute("/_authenticated/revisoes")({
  head: () => ({
    meta: [
      { title: "Revisões FSRS — Estuda" },
      {
        name: "description",
        content: "Revisões por card com agendamento FSRS e criação de conteúdo obrigatório.",
      },
      { property: "og:title", content: "Revisões FSRS — Estuda" },
      {
        property: "og:description",
        content: "Cards individuais são agendados por FSRS e revisados com pergunta e resposta.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RevisoesPage,
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function daysUntil(due: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${due}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function RevisoesPage() {
  const fetchDecks = useServerFn(listDecks);
  const fetchCards = useServerFn(listCards);

  const { data: decks = [], isLoading: decksLoading } = useQuery({
    queryKey: ["decks"],
    queryFn: () => fetchDecks(),
  });

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ["cards"],
    queryFn: () => fetchCards(),
  });

  const fetchSettings = useServerFn(getUserSettings);
  const { data: settings } = useQuery({
    queryKey: ["user_settings"],
    queryFn: () => fetchSettings(),
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const deckById = Object.fromEntries(decks.map((deck) => [deck.id, deck]));
  const deckMap = Object.fromEntries(decks.map((deck) => [deck.id, deck.name]));

  function findRootDeckName(deckId?: string | null) {
    if (!deckId) return "(sem deck)";
    let cur: any = deckById[deckId];
    if (!cur) return "(sem deck)";
    while (cur && cur.parent_id) {
      cur = deckById[cur.parent_id];
    }
    return cur?.name ?? "(sem deck)";
  }

  // First-level subdeck: the ancestor of the card's own deck that sits
  // directly under the root ("primeiros subdecks do deck principal" —
  // deeper descendants collapse into this level, and a card whose own deck
  // *is* the root has no subdeck to report).
  function findLevel1SubdeckName(deckId?: string | null): string | null {
    if (!deckId) return null;
    const chain: any[] = [];
    let cur: any = deckById[deckId];
    while (cur) {
      chain.push(cur);
      if (!cur.parent_id) break;
      cur = deckById[cur.parent_id];
    }
    // chain[0] = the card's own deck, chain[last] = root.
    // The first-level subdeck is the entry just below the root.
    if (chain.length < 2) return null;
    return chain[chain.length - 2].name;
  }

  // A subdeck without its own exam_date inherits the nearest ancestor's —
  // set the date on the module (root) and every subdeck picks it up.
  function findNearestExamDate(deckId?: string | null): string | null {
    let cur: { exam_date?: string | null; parent_id?: string | null } | null | undefined = deckId
      ? deckById[deckId]
      : null;
    while (cur) {
      if (cur.exam_date) return cur.exam_date;
      cur = cur.parent_id ? deckById[cur.parent_id] : null;
    }
    return null;
  }

  // Cards due today or earlier, each tagged with its root deck name — the
  // tag rides along into ReviewSession so the end-of-session summary can
  // group correct/incorrect per deck without a second lookup.
  const cardsToReview = cards
    .filter((card) => {
      // Suspended cards keep their scheduling but stay out of the queue.
      if (card.suspended) return false;
      try {
        const dueDate = new Date(`${card.due}T00:00:00`);
        return dueDate <= todayStart;
      } catch {
        return false;
      }
    })
    .map((card) => ({
      ...card,
      rootDeckName: findRootDeckName(card.deck_id),
      level1SubdeckName: findLevel1SubdeckName(card.deck_id),
      // A card with zero reps has never been graded — that's the "new
      // card" distinction the separate daily limit cares about.
      isNew: card.reps === 0,
      // occlusion_regions comes back as generic Json from the DB; narrow it
      // to the shape ReviewSession expects, defaulting to null if it's
      // anything unexpected rather than trusting the cast blindly.
      occlusion_regions: Array.isArray(card.occlusion_regions)
        ? (card.occlusion_regions as unknown as OcclusionRegion[])
        : null,
    }));

  const todayISO = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, "0")}-${String(todayStart.getDate()).padStart(2, "0")}`;

  // Cards due soonest for a deck with an exam coming up jump the queue —
  // ties (including "no exam date at all") keep the original due-date
  // order, since Array#sort is stable.
  const prioritizedCards = [...cardsToReview].sort((a, b) => {
    const examA = findNearestExamDate(a.deck_id);
    const examB = findNearestExamDate(b.deck_id);
    if (examA && examB) return examA < examB ? -1 : examA > examB ? 1 : 0;
    if (examA) return -1;
    if (examB) return 1;
    return 0;
  });

  // Cards already reviewed today consume the same allowance, so reopening
  // the app doesn't hand out a fresh quota. reps === 1 on a card reviewed
  // today means that review was its first — i.e. it was new before then.
  const reviewedToday = cards
    .filter((c) => (c.last_review ?? "").slice(0, 10) === todayISO)
    .map((c) => ({ deck_id: c.deck_id, isNew: c.reps === 1 }));

  const { allowed: limitedCards, blocked: blockedByLimit } = applyDailyLimits({
    dueCards: prioritizedCards,
    decks,
    globalLimit: settings?.daily_limit ?? null,
    globalNewLimit: settings?.daily_new_limit ?? null,
    reviewedToday,
  });

  // Keep the enriched card objects (rootDeckName etc.) that the session needs.
  const allowedIds = new Set(limitedCards.map((c) => c.id));
  const queue = prioritizedCards.filter((c) => allowedIds.has(c.id));

  const reviewCount = queue.length;
  const [showSession, setShowSession] = useState(false);

  // Deck tree, mirroring the Flashcards tab so both tabs read the same way.
  const childrenMap: Record<string, any[]> = {};
  for (const d of decks) {
    const pid = d.parent_id ?? "__root";
    childrenMap[pid] = childrenMap[pid] || [];
    childrenMap[pid].push(d);
  }
  for (const pid of Object.keys(childrenMap)) {
    childrenMap[pid]?.sort(compareDecks);
  }
  const roots = childrenMap["__root"] ?? [];

  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));

  /** Every deck id in a subtree, so a parent can study its children too. */
  function collectDeckIds(deckId: string): string[] {
    const ids = [deckId];
    for (const child of childrenMap[deckId] ?? []) ids.push(...collectDeckIds(child.id));
    return ids;
  }

  /** Cards due in this deck and everything under it. */
  function dueInSubtree(deckId: string) {
    const ids = new Set(collectDeckIds(deckId));
    return queue.filter((c) => ids.has(c.deck_id));
  }

  // Which subset the session runs on: null = the whole queue.
  const [sessionCards, setSessionCards] = useState<typeof queue | null>(null);

  function startSession(subset: typeof queue) {
    if (subset.length === 0) {
      toast.info("Nenhum card para revisar neste deck.");
      return;
    }
    setSessionCards(subset);
    setShowSession(true);
  }

  /**
   * One deck in the tree: its own due cards when expanded, its subdecks
   * nested below, and a count that includes the whole subtree — the number
   * you'd actually face if you hit "Estudar" on this row.
   */
  function renderDeckNode(deck: any, level = 0) {
    const children = childrenMap[deck.id] ?? [];
    const isOpen = !!openIds[deck.id];
    const subtreeDue = dueInSubtree(deck.id);
    const ownDue = queue.filter((c) => c.deck_id === deck.id);

    return (
      <section key={deck.id} className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button size="icon" variant="ghost" className="size-7" onClick={() => toggle(deck.id)}>
            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={deck.name}>
            {deck.name}
          </h3>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs",
              subtreeDue.length > 0 ? "bg-primary/15 text-primary" : "text-muted-foreground",
            )}
          >
            {subtreeDue.length} para hoje
          </span>
          <div className="ml-auto shrink-0">
            <Button
              size="sm"
              variant={subtreeDue.length > 0 ? "default" : "ghost"}
              disabled={subtreeDue.length === 0}
              className="h-7 px-2.5 text-xs"
              onClick={() => startSession(subtreeDue)}
            >
              <Play className="size-3.5" />
              <span className="ml-1.5">Estudar</span>
            </Button>
          </div>
        </div>

        {isOpen && (
          <div className="mt-3 space-y-3">
            {ownDue.length === 0 ? (
              // Only worth saying when there's nothing nested below either —
              // otherwise it contradicts the subdeck rows right underneath.
              children.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum card deste deck para hoje.</p>
              ) : null
            ) : (
              <ul className="space-y-3">
                {ownDue.map((card) => {
                  const diff = daysUntil(card.due);
                  return (
                    <li
                      key={card.id}
                      className="rounded-xl border border-border bg-background p-3 sm:p-4"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="break-words font-medium">{card.pergunta}</p>
                        {isLeech(card) && (
                          <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] uppercase text-destructive">
                            Leech
                          </span>
                        )}
                        <span
                          className={cn(
                            "flex items-center gap-1.5 text-xs",
                            diff < 0 ? "text-overdue" : "text-muted-foreground",
                          )}
                        >
                          <CalendarClock className="size-3.5" />
                          {capitalizeFirst(dateFormatter.format(new Date(`${card.due}T00:00:00`)))}
                          {" · "}
                          {diff === 0
                            ? "hoje"
                            : diff > 0
                              ? `em ${diff} dia(s)`
                              : `atrasado ${Math.abs(diff)} dia(s)`}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {children.length > 0 && (
              <div className="space-y-3 pl-6">
                {children.map((child) => (
                  <div key={child.id}>{renderDeckNode(child, level + 1)}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />

        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Revisões</h1>
            <div className="ml-auto">
              <Button variant="ghost" onClick={() => startSession(queue)}>
                <Play className="size-4" />
                <span className="ml-2">Começar</span>
              </Button>
            </div>
          </header>

          <main className="flex flex-1 justify-center p-3 sm:p-6">
            <div className="w-full max-w-3xl">
              {showSession && (
                <div className="fixed inset-0 z-50">
                  <ReviewSession
                    cards={sessionCards ?? queue}
                    onExit={() => setShowSession(false)}
                    onComplete={() => setShowSession(false)}
                  />
                </div>
              )}
              {decksLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : decks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Nenhum deck ainda. Crie um deck na página de criação.
                </p>
              ) : cardsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : reviewCount === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Nenhum card para revisar hoje.
                </p>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
                    <span>{reviewCount} cards para revisar hoje</span>
                    {blockedByLimit > 0 && (
                      <span className="text-xs">{blockedByLimit} além do limite diário</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {roots.map((root) => (
                      <div key={root.id}>{renderDeckNode(root)}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}