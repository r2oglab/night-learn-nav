import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { listCards } from "@/lib/cards.functions";
import { listDecks } from "@/lib/decks.functions";
import { cn } from "@/lib/utils";
import ReviewSession from "@/components/review-session";

export const Route = createFileRoute("/_authenticated/revisoes")({
  head: () => ({
    meta: [
      { title: "Revisões FSRS — Estuda" },
      {
        name: "description",
        content:
          "Revisões por card com agendamento FSRS e criação de conteúdo obrigatório.",
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

  // Cards due today or earlier, each tagged with its root deck name — the
  // tag rides along into ReviewSession so the end-of-session summary can
  // group correct/incorrect per deck without a second lookup.
  const cardsToReview = cards
    .filter((card) => {
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
    }));

  const reviewCount = cardsToReview.length;
  const [showSession, setShowSession] = useState(false);

  const groupsByRootDeck = new Map<string, typeof cardsToReview>();
  for (const card of cardsToReview) {
    const group = groupsByRootDeck.get(card.rootDeckName) ?? [];
    group.push(card);
    groupsByRootDeck.set(card.rootDeckName, group);
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
              <Button
                variant="ghost"
                onClick={() => {
                  if (reviewCount === 0) { toast.info("Nenhum card para revisar hoje."); return; }
                  setShowSession(true);
                }}
              >
                <Play className="size-4" />
                <span className="ml-2">Começar</span>
              </Button>
            </div>
          </header>

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-3xl">
              {showSession && (
                <div className="fixed inset-0 z-50">
                  <ReviewSession
                    cards={cardsToReview}
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
                  <div className="mb-4 text-sm text-muted-foreground">{reviewCount} cards para revisar hoje</div>
                  <div className="space-y-6">
                    {Array.from(groupsByRootDeck.entries()).map(([rootName, groupCards]) => (
                      <div key={rootName}>
                        <h3 className="mb-2 text-sm font-semibold">{rootName}</h3>
                        <ul className="space-y-3">
                          {groupCards.map((card) => {
                            const diff = daysUntil(card.due);
                            return (
                              <li key={card.id} className="rounded-xl border border-border bg-card p-4">
                                <div className="flex flex-wrap items-center gap-3">
                                  <p className="font-medium">{card.pergunta}</p>
                                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                    {deckMap[card.deck_id] ?? "Deck desconhecido"}
                                  </span>
                                  <span
                                    className={cn(
                                      "flex items-center gap-1.5 text-xs",
                                      diff < 0 ? "text-overdue" : "text-muted-foreground",
                                    )}
                                  >
                                    <CalendarClock className="size-3.5" />
                                    {dateFormatter.format(new Date(`${card.due}T00:00:00`))}
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
                      </div>
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