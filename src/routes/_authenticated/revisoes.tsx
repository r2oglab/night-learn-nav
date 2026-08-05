import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ratingOptions, stateLabels } from "@/lib/fsrs";
import { listCards, reviewCard } from "@/lib/cards.functions";
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
  const queryClient = useQueryClient();
  const fetchDecks = useServerFn(listDecks);
  const fetchCards = useServerFn(listCards);
  const gradeCard = useServerFn(reviewCard);

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

  const cardsToReview = cards.filter((card) => {
    try {
      const dueDate = new Date(`${card.due}T00:00:00`);
      return dueDate <= todayStart;
    } catch {
      return false;
    }
  });

  const reviewCount = cardsToReview.length;
  const [showSession, setShowSession] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cards"] });
    void queryClient.invalidateQueries({ queryKey: ["decks"] });
  };

  const review = useMutation({
    mutationFn: (vars: { id: string; rating: number }) =>
      gradeCard({ data: vars }),
    onSuccess: (updated) => {
      invalidate();
      toast.success(
        `Próxima revisão: ${dateFormatter.format(new Date(`${updated.due}T00:00:00`))}`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deckMap = Object.fromEntries(decks.map((deck) => [deck.id, deck.name]));

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />

        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Revisões</h1>
            <span className="ml-auto text-xs text-muted-foreground">
              Cards individuais com FSRS
            </span>
            <div className="ml-3">
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
                  {showSession && (
                    <>
                      {/* Render fullscreen review session */}
                      <div className="fixed inset-0 z-50">
                        <ReviewSession
                          cards={cardsToReview}
                          onExit={() => setShowSession(false)}
                          onComplete={() => setShowSession(false)}
                        />
                      </div>
                    </>
                  )}
                  <div className="mb-4 text-sm text-muted-foreground">{reviewCount} cards para revisar hoje</div>
                  <ul className="space-y-3">
                    {cardsToReview.map((card) => {
                      const diff = daysUntil(card.due);
                      return (
                        <li key={card.id} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <div>
                            <p className="font-medium">{card.pergunta}</p>
                            <p className="text-sm text-muted-foreground">{card.resposta}</p>
                          </div>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {deckMap[card.deck_id] ?? "Deck desconhecido"}
                          </span>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {stateLabels[card.state] ?? "Novo"}
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

                        <div className="mt-3 flex flex-wrap gap-2">
                          {ratingOptions.map((option) => (
                            <Button
                              key={option.value}
                              size="sm"
                              variant="outline"
                              disabled={review.isPending}
                              onClick={() =>
                                review.mutate({ id: card.id, rating: option.value })
                              }
                            >
                              {option.label}
                            </Button>
                          ))}
                          <span className="self-center text-[11px] text-muted-foreground">
                            {card.reps} revisão(ões) · estabilidade {card.stability.toFixed(1)}d
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
