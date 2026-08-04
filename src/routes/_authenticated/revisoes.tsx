import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ratingOptions, stateLabels } from "@/lib/fsrs";
import { createTheme, deleteTheme, listThemes, reviewTheme } from "@/lib/themes.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/revisoes")({
  head: () => ({
    meta: [
      { title: "Revisões FSRS — Estuda" },
      {
        name: "description",
        content:
          "Cada tema recebe a próxima data de revisão calculada pelo algoritmo FSRS conforme o seu desempenho.",
      },
      { property: "og:title", content: "Revisões FSRS — Estuda" },
      {
        property: "og:description",
        content: "Próximas revisões de cada tema calculadas pelo algoritmo FSRS.",
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
  const addTheme = useServerFn(createTheme);
  const gradeTheme = useServerFn(reviewTheme);
  const removeTheme = useServerFn(deleteTheme);
  const [name, setName] = useState("");

  const { data: themes = [], isLoading } = useQuery({
    queryKey: ["themes"],
    queryFn: () => fetchThemes(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["themes"] });
    void queryClient.invalidateQueries({ queryKey: ["revisions"] });
  };

  const create = useMutation({
    mutationFn: (themeName: string) => addTheme({ data: { name: themeName } }),
    onSuccess: () => {
      setName("");
      invalidate();
      toast.success("Tema adicionado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const review = useMutation({
    mutationFn: (vars: { id: string; rating: number }) => gradeTheme({ data: vars }),
    onSuccess: (updated) => {
      invalidate();
      toast.success(
        `Próxima revisão: ${dateFormatter.format(new Date(`${updated.due}T00:00:00`))}`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const destroy = useMutation({
    mutationFn: (id: string) => removeTheme({ data: { id } }),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

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
              Agendamento por FSRS
            </span>
          </header>

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-3xl">
              <form
                className="mb-6 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim()) create.mutate(name);
                }}
              >
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Novo tema (ex.: Anatomia)"
                />
                <Button type="submit" disabled={create.isPending || !name.trim()}>
                  {create.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Adicionar
                </Button>
              </form>

              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : themes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Nenhum tema ainda. Adicione um para começar a agendar revisões.
                </p>
              ) : (
                <ul className="space-y-3">
                  {themes.map((theme) => {
                    const diff = daysUntil(theme.due);
                    return (
                      <li
                        key={theme.id}
                        className="rounded-xl border border-border bg-card p-4"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-medium">{theme.name}</span>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {stateLabels[theme.state] ?? "Novo"}
                          </span>
                          <span
                            className={cn(
                              "flex items-center gap-1.5 text-xs",
                              diff < 0 ? "text-overdue" : "text-muted-foreground",
                            )}
                          >
                            <CalendarClock className="size-3.5" />
                            {dateFormatter.format(new Date(`${theme.due}T00:00:00`))}
                            {" · "}
                            {diff === 0
                              ? "hoje"
                              : diff > 0
                                ? `em ${diff} dia(s)`
                                : `atrasada ${Math.abs(diff)} dia(s)`}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto size-8 text-muted-foreground"
                            onClick={() => destroy.mutate(theme.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {ratingOptions.map((option) => (
                            <Button
                              key={option.value}
                              size="sm"
                              variant="outline"
                              disabled={review.isPending}
                              onClick={() =>
                                review.mutate({ id: theme.id, rating: option.value })
                              }
                            >
                              {option.label}
                            </Button>
                          ))}
                          <span className="self-center text-[11px] text-muted-foreground">
                            {theme.reps} revisão(ões) · estabilidade{" "}
                            {theme.stability.toFixed(1)}d
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
