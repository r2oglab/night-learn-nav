import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Trash, Loader2, Edit3, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { listDecks, deleteDeck, updateDeck } from "@/lib/decks.functions";
import { listCards, deleteCard, updateCard } from "@/lib/cards.functions";

export const Route = createFileRoute("/_authenticated/flashcards")({
  component: FlashcardsPage,
});

function FlashcardsPage() {
  const queryClient = useQueryClient();
  const fetchDecks = useServerFn(listDecks);
  const fetchCards = useServerFn(listCards);
  const removeCard = useServerFn(deleteCard);

  const { data: decks = [], isLoading: decksLoading } = useQuery({
    queryKey: ["decks"],
    queryFn: () => fetchDecks(),
  });

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ["cards"],
    queryFn: () => fetchCards(),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState("");
  const [editingAnswer, setEditingAnswer] = useState("");

  const delMutation = useMutation({
    mutationFn: (id: string) => removeCard({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success("Card excluído");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeDeckServer = useServerFn(deleteDeck);
  const removeDeck = useMutation({
    mutationFn: (id: string) => removeDeckServer({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success("Deck excluído");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [editingDeckName, setEditingDeckName] = useState("");

  const updateDeckServer = useServerFn(updateDeck);
  const updateDeckMutation = useMutation({
    mutationFn: (vars: { id: string; name: string }) => updateDeckServer({ data: vars }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      setEditingDeckId(null);
      setEditingDeckName("");
      toast.success("Deck atualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateServer = useServerFn(updateCard);
  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; pergunta: string; resposta: string }) =>
      updateServer({ data: vars }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      setEditingId(null);
      toast.success("Card atualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Build maps for tree
  const deckById = Object.fromEntries(decks.map((t: any) => [t.id, t]));
  const childrenMap: Record<string, any[]> = {};
  for (const t of decks) {
    const pid = t.parent_id ?? "__root";
    childrenMap[pid] = childrenMap[pid] || [];
    childrenMap[pid].push(t);
  }

  const getPath = (deckId: string) => {
    const parts: string[] = [];
    let cur: any = deckById[deckId];
    while (cur) {
      parts.push(cur.name);
      if (!cur.parent_id) break;
      cur = deckById[cur.parent_id];
    }
    return parts.reverse().join("::");
  };

  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpenIds((s) => ({ ...s, [id]: !s[id] }));

  function TreeNode({ deck, level = 0 }: { deck: any; level?: number }) {
    const children = childrenMap[deck.id] ?? [];
    const isOpen = !!openIds[deck.id];
    const deckCards = cards.filter((c: any) => c.deck_id === deck.id);

    return (
      <section key={deck.id} className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-3">
          {children.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => toggle(deck.id)}>
              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          ) : (
            <div style={{ width: 36 }} />
          )}

          {editingDeckId === deck.id ? (
            <div className="flex items-center gap-2 w-full">
              <Input value={editingDeckName} onChange={(e) => setEditingDeckName(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => updateDeckMutation.mutate({ id: deck.id, name: editingDeckName })}>
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingDeckId(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <h3 className="text-sm font-medium">{deck.name}</h3>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => {
                  setEditingDeckId(deck.id);
                  setEditingDeckName(deck.name);
                }}>
                  Editar
                </Button>
                <Button size="sm" variant="destructive" onClick={() => {
                  const count = deckCards.length;
                  const ok = window.confirm(`Excluir deck "${deck.name}"? Isso também removerá ${count} card(s) deste deck.`);
                  if (ok) removeDeck.mutate(deck.id);
                }}>
                  Excluir deck
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Always render this deck's own cards */}
        {deckCards.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum card neste deck.</p>
        ) : (
          <ul className="space-y-3">
            {deckCards.map((card: any) => (
              <li key={card.id} className="flex items-start justify-between gap-4">
                {editingId === card.id ? (
                  <div className="flex-1">
                    <label className="flex flex-col gap-2">
                      <Input value={editingQuestion} onChange={(e) => setEditingQuestion(e.target.value)} />
                      <Input value={editingAnswer} onChange={(e) => setEditingAnswer(e.target.value)} />
                    </label>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: card.id, pergunta: editingQuestion, resposta: editingAnswer })}>
                        Salvar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="font-medium">{card.pergunta}</p>
                      <p className="text-sm text-muted-foreground">{card.resposta}</p>
                      <div className="mt-1 text-xs text-muted-foreground">{getPath(card.deck_id)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => {
                        setEditingId(card.id);
                        setEditingQuestion(card.pergunta);
                        setEditingAnswer(card.resposta);
                      }}>
                        <Edit3 className="size-4" /> Editar
                      </Button>
                      <Button size="sm" variant="destructive" disabled={delMutation.isPending} onClick={() => delMutation.mutate(card.id)}>
                        <Trash className="size-4" /> Excluir
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Render subdecks below, when expanded */}
        {children.length > 0 && isOpen && (
          <div className="mt-3 space-y-3 pl-6">
            {children.map((child) => (
              <TreeNode key={child.id} deck={child} level={level + 1} />
            ))}
          </div>
        )}
      </section>
    );
  }

  const roots = childrenMap["__root"] || [];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Flashcards</h1>
            <span className="ml-auto text-xs text-muted-foreground">Listagem por deck</span>
          </header>

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-3xl">
              {decksLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : decks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nenhum deck ainda.</p>
              ) : cardsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {roots.map((root) => (
                    <TreeNode key={root.id} deck={root} />
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export default FlashcardsPage;
