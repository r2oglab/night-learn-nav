import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ratingOptions, stateLabels } from "@/lib/fsrs";
import { createCard, listCards, reviewCard } from "@/lib/cards.functions";
import { createTheme, listThemes } from "@/lib/themes.functions";
import { cn } from "@/lib/utils";

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
  const fetchThemes = useServerFn(listThemes);
  const fetchCards = useServerFn(listCards);
  const addCard = useServerFn(createCard);
  const createNewTheme = useServerFn(createTheme);
  const gradeCard = useServerFn(reviewCard);
  const [themeName, setThemeName] = useState("");
  const [themeId, setThemeId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const { data: themes = [], isLoading: themesLoading } = useQuery({
    queryKey: ["themes"],
    queryFn: () => fetchThemes(),
  });

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ["cards"],
    queryFn: () => fetchCards(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cards"] });
    void queryClient.invalidateQueries({ queryKey: ["themes"] });
  };

  const createThemeMutation = useMutation({
    mutationFn: (name: string) => createNewTheme({ data: { name } }),
    onSuccess: () => {
      setThemeName("");
      invalidate();
      toast.success("Tema criado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const create = useMutation({
    mutationFn: (vars: { theme_id: string; pergunta: string; resposta: string }) =>
      addCard({ data: vars }),
    onSuccess: () => {
      setQuestion("");
      setAnswer("");
      setThemeId("");
      invalidate();
      toast.success("Card adicionado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

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

  const themeMap = Object.fromEntries(themes.map((theme) => [theme.id, theme.name]));

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
          </header>

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-3xl">
              <form
                className="mb-6 grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (themeName.trim()) {
                    createThemeMutation.mutate(themeName.trim());
                  }
                }}
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    Novo tema
                    <Input
                      value={themeName}
                      onChange={(event) => setThemeName(event.target.value)}
                      placeholder="Nome do tema"
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={createThemeMutation.isPending || !themeName.trim()}
                  >
                    {createThemeMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    Criar tema
                  </Button>
                </div>
              </form>

              <form
                className="mb-6 grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (question.trim() && answer.trim() && themeId) {
                    create.mutate({ theme_id: themeId, pergunta: question.trim(), resposta: answer.trim() });
                  }
                }}
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    Tema
                    <select
                      value={themeId}
                      onChange={(event) => setThemeId(event.target.value)}
                      className="h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">Selecione um tema</option>
                      {themes.map((theme) => (
                        <option key={theme.id} value={theme.id}>
                          {theme.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    Pergunta
                    <Input
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="Escreva a pergunta do card"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                  Resposta
                  <Input
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="Escreva a resposta do card"
                  />
                </label>
                <Button
                  type="submit"
                  disabled={
                    create.isPending || !question.trim() || !answer.trim() || !themeId || themes.length === 0
                  }
                >
                  {create.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Criar card
                </Button>
              </form>

              {themesLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : themes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Crie um tema antes de adicionar cards. O grupo de temas mantém apenas nomes e agrupamentos.
                </p>
              ) : cardsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : cards.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Nenhum card ainda. Crie um card para começar a revisar.
                </p>
              ) : (
                <ul className="space-y-3">
                  {cards.map((card) => {
                    const diff = daysUntil(card.due);
                    return (
                      <li key={card.id} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <div>
                            <p className="font-medium">{card.pergunta}</p>
                            <p className="text-sm text-muted-foreground">{card.resposta}</p>
                          </div>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {themeMap[card.theme_id] ?? "Tema desconhecido"}
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
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
