import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { listThemes } from "@/lib/themes.functions";
import { listCards, deleteCard } from "@/lib/cards.functions";

export const Route = createFileRoute("/_authenticated/flashcards")({
  component: FlashcardsPage,
});

function FlashcardsPage() {
  const queryClient = useQueryClient();
  const fetchThemes = useServerFn(listThemes);
  const fetchCards = useServerFn(listCards);
  const removeCard = useServerFn(deleteCard);

  const { data: themes = [], isLoading: themesLoading } = useQuery({
    queryKey: ["themes"],
    queryFn: () => fetchThemes(),
  });

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ["cards"],
    queryFn: () => fetchCards(),
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => removeCard({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success("Card excluído");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Flashcards</h1>
            <span className="ml-auto text-xs text-muted-foreground">Listagem por tema</span>
          </header>

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-3xl">
              {themesLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : themes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Nenhum tema ainda.
                </p>
              ) : cardsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-6">
                  {themes.map((theme) => {
                    const themeCards = cards.filter((c) => c.theme_id === theme.id);
                    return (
                      <section key={theme.id} className="rounded-xl border border-border bg-card p-4">
                        <h2 className="mb-3 text-sm font-medium">{theme.name}</h2>
                        {themeCards.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhum card neste tema.</p>
                        ) : (
                          <ul className="space-y-3">
                            {themeCards.map((card) => (
                              <li key={card.id} className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="font-medium">{card.pergunta}</p>
                                  <p className="text-sm text-muted-foreground">{card.resposta}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={delMutation.isPending}
                                    onClick={() => delMutation.mutate(card.id)}
                                  >
                                    <Trash className="size-4" />
                                    Excluir
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
