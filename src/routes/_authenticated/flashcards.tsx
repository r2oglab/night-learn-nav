import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Download,
  Eye,
  Pencil,
  Trash2,
  CalendarClock,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { listDecks, deleteDeck, updateDeck } from "@/lib/decks.functions";
import {
  listCards,
  deleteCard,
  updateCard,
  updateImageOcclusion,
  postponeCard,
  setCardSuspended,
} from "@/lib/cards.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { CardPreviewDialog, type PreviewCard } from "@/components/card-preview-dialog";
import { buildCardsCsv, downloadTextFile } from "@/lib/csv-export";
import { ImageOcclusionEditor, type RegionDraft } from "@/components/image-occlusion-editor";
import {
  ClozeEditor,
  isClozeText,
  maskCloze,
  revealCloze,
  parseClozeText,
  buildClozeText,
} from "@/components/cloze-editor";

export const Route = createFileRoute("/_authenticated/flashcards")({
  component: FlashcardsPage,
});

function FlashcardsPage() {
  const queryClient = useQueryClient();
  const fetchDecks = useServerFn(listDecks);
  const fetchCards = useServerFn(listCards);
  const removeCard = useServerFn(deleteCard);
  const postponeServer = useServerFn(postponeCard);
  const suspendServer = useServerFn(setCardSuspended);

  const postponeMutation = useMutation({
    mutationFn: (vars: { id: string; days: number }) =>
      postponeServer({ data: { ...vars, tz_offset_minutes: new Date().getTimezoneOffset() } }),
    onSuccess: (_d, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success(`Card adiado por ${vars.days} dia(s)`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const suspendMutation = useMutation({
    mutationFn: (vars: { id: string; suspended: boolean }) => suspendServer({ data: vars }),
    onSuccess: (_d, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success(vars.suspended ? "Card suspenso" : "Card reativado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

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
  // A cloze card being edited is reopened in the same click-the-words UI it
  // was created with, rather than exposing raw {{c::}} markers.
  const [editingIsCloze, setEditingIsCloze] = useState(false);
  const [editingClozeText, setEditingClozeText] = useState("");
  const [editingClozeHidden, setEditingClozeHidden] = useState<Set<number>>(new Set());

  function startEditingCard(card: any) {
    setEditingId(card.id);
    if (isClozeText(card.pergunta)) {
      const { text, hidden } = parseClozeText(card.pergunta);
      setEditingIsCloze(true);
      setEditingClozeText(text);
      setEditingClozeHidden(hidden);
      setEditingQuestion("");
      setEditingAnswer("");
    } else {
      setEditingIsCloze(false);
      setEditingQuestion(card.pergunta);
      setEditingAnswer(card.resposta);
    }
  }

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

  // Occlusion editing: the card whose mask layout is being reworked.
  const [occlusionCard, setOcclusionCard] = useState<any | null>(null);
  const [savingOcclusion, setSavingOcclusion] = useState(false);
  const saveOcclusion = useServerFn(updateImageOcclusion);

  async function handleOcclusionSave(file: File | null, newRegions: RegionDraft[]) {
    if (!occlusionCard) return;
    setSavingOcclusion(true);
    try {
      let imageUrl: string | undefined;
      // A cropped or text-annotated picture is a NEW file: upload it and
      // point every card of this set at it.
      if (file) {
        const path = `${crypto.randomUUID()}.png`;
        const { error: uploadError } = await supabase.storage
          .from("card-images")
          .upload(path, file);
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from("card-images").getPublicUrl(path).data.publicUrl;
      }

      const result = await saveOcclusion({
        data: {
          card_id: occlusionCard.id,
          image_url: imageUrl,
          tz_offset_minutes: new Date().getTimezoneOffset(),
          regions: newRegions.map((r) => ({
            id: r.id,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            label: r.label.trim() || undefined,
          })),
        },
      });

      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success(
        `Áreas atualizadas: ${result.updated} mantida(s), ${result.added} nova(s), ${result.removed} removida(s)`,
      );
      setOcclusionCard(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingOcclusion(false);
    }
  }

  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [editingDeckLimit, setEditingDeckLimit] = useState("");

  const updateDeckServer = useServerFn(updateDeck);
  const updateDeckMutation = useMutation({
    mutationFn: (vars: { id: string; name: string; daily_limit?: number | null }) =>
      updateDeckServer({ data: vars }),
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

  const [previewCard, setPreviewCard] = useState<PreviewCard | null>(null);

  /** Export a deck (and its subdecks) as CSV our own importer can read back. */
  function exportDeck(deck: any) {
    const { csv, count } = buildCardsCsv(cards as any, decks as any, deck.id);
    if (count === 0) {
      toast.info("Nenhum card para exportar neste deck.");
      return;
    }
    const safeName = deck.name.replace(/[^\p{L}\p{N}_-]+/gu, "_");
    downloadTextFile(`${safeName}_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(`${count} card(s) exportado(s)`);
  }

  const [query, setQuery] = useState("");

  /**
   * Accent- and case-insensitive matching: searching "celula" should find
   * "célula", which is the common case when typing quickly in Portuguese.
   */
  const normalizeForSearch = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const searchResults = (() => {
    const q = normalizeForSearch(query.trim());
    if (!q) return null;
    return cards.filter((c: any) => {
      const haystack = normalizeForSearch(
        `${c.pergunta ?? ""} ${c.resposta ?? ""} ${getPath(c.deck_id)}`,
      );
      return haystack.includes(q);
    });
  })();

  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpenIds((s) => ({ ...s, [id]: !s[id] }));

  const collectDeckIds = (deckId: string): string[] => {
    const ids = [deckId];
    for (const child of childrenMap[deckId] ?? []) {
      ids.push(...collectDeckIds(child.id));
    }
    return ids;
  };

  /** One card row: shared by the deck tree and the search results. */
  function renderCardRow(card: any) {
    return (
      <li
        key={card.id}
        className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      >
        {editingId === card.id ? (
          <div className="flex-1">
            {editingIsCloze ? (
              <ClozeEditor
                text={editingClozeText}
                hidden={editingClozeHidden}
                onTextChange={(v) => {
                  setEditingClozeText(v);
                  setEditingClozeHidden(new Set());
                }}
                onToggleToken={(i) =>
                  setEditingClozeHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
              />
            ) : (
              <label className="flex flex-col gap-2">
                <Input
                  value={editingQuestion}
                  onChange={(e) => setEditingQuestion(e.target.value)}
                />
                <Input value={editingAnswer} onChange={(e) => setEditingAnswer(e.target.value)} />
              </label>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={
                  updateMutation.isPending ||
                  (editingIsCloze && (!editingClozeText.trim() || editingClozeHidden.size === 0))
                }
                onClick={() => {
                  if (editingIsCloze) {
                    const stored = buildClozeText(editingClozeText, editingClozeHidden);
                    updateMutation.mutate({
                      id: card.id,
                      pergunta: stored,
                      resposta: stored,
                    });
                  } else {
                    updateMutation.mutate({
                      id: card.id,
                      pergunta: editingQuestion,
                      resposta: editingAnswer,
                    });
                  }
                }}
              >
                Salvar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className={cn("flex gap-3", card.suspended && "opacity-50")}>
              {card.image_url && !card.occlusion_target_id && (
                <img
                  src={card.image_url}
                  alt=""
                  className="size-14 shrink-0 rounded-md border border-border object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                {card.suspended && (
                  <span className="mb-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    Suspenso
                  </span>
                )}
                {isClozeText(card.pergunta) ? (
                  <>
                    <p className="font-medium">{maskCloze(card.pergunta)}</p>
                    <p className="text-sm text-muted-foreground">{revealCloze(card.pergunta)}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">{card.pergunta}</p>
                    <p className="text-sm text-muted-foreground">{card.resposta}</p>
                  </>
                )}
                <div className="mt-1 text-xs text-muted-foreground">{getPath(card.deck_id)}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title="Ver prévia"
                onClick={() => setPreviewCard(card)}
              >
                <Eye className="size-3.5" />
                <span className="sr-only">Ver prévia</span>
              </Button>
              {card.image_url ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Editar áreas"
                  onClick={() => setOcclusionCard(card)}
                >
                  <Pencil className="size-3.5" />
                  <span className="sr-only">Editar áreas</span>
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Editar"
                  onClick={() => startEditingCard(card)}
                >
                  <Pencil className="size-3.5" />
                  <span className="sr-only">Editar</span>
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title="Adiar"
                onClick={() => {
                  const input = window.prompt("Adiar por quantos dias?", "1");
                  if (input === null) return;
                  const days = Number(input);
                  if (!Number.isFinite(days) || days < 1) {
                    toast.error("Informe um número de dias válido.");
                    return;
                  }
                  postponeMutation.mutate({ id: card.id, days: Math.round(days) });
                }}
              >
                <CalendarClock className="size-3.5" />
                <span className="sr-only">Adiar</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title={card.suspended ? "Reativar" : "Suspender"}
                onClick={() => suspendMutation.mutate({ id: card.id, suspended: !card.suspended })}
              >
                {card.suspended ? (
                  <PlayCircle className="size-3.5" />
                ) : (
                  <PauseCircle className="size-3.5" />
                )}
                <span className="sr-only">{card.suspended ? "Reativar" : "Suspender"}</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                title="Excluir card"
                disabled={delMutation.isPending}
                onClick={() => {
                  const ok = window.confirm(`Excluir o card "${card.pergunta}"?`);
                  if (ok) delMutation.mutate(card.id);
                }}
              >
                <Trash2 className="size-3.5" />
                <span className="sr-only">Excluir card</span>
              </Button>
            </div>
          </>
        )}
      </li>
    );
  }

  // Rendered as a plain function call, not <TreeNode/>: this closure is
  // recreated on every render of FlashcardsPage, so as a JSX element React
  // would treat each render as a *different* component type and remount the
  // whole subtree — which blew away input focus on every keystroke.
  function renderTreeNode(deck: any, level = 0) {
    const children = childrenMap[deck.id] ?? [];
    const isOpen = !!openIds[deck.id];
    const deckCards = cards.filter((c: any) => c.deck_id === deck.id);
    const totalCardCount = collectDeckIds(deck.id).reduce(
      (sum, id) => sum + cards.filter((c: any) => c.deck_id === id).length,
      0,
    );

    return (
      <section key={deck.id} className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 sm:gap-3">
          <Button size="sm" variant="ghost" onClick={() => toggle(deck.id)}>
            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>

          {editingDeckId === deck.id ? (
            <div className="flex w-full flex-wrap items-end gap-2">
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                Nome
                <Input
                  value={editingDeckName}
                  onChange={(e) => setEditingDeckName(e.target.value)}
                />
              </label>
              <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
                Limite/dia
                <Input
                  type="number"
                  min={0}
                  value={editingDeckLimit}
                  onChange={(e) => setEditingDeckLimit(e.target.value)}
                  placeholder="Sem limite"
                />
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    updateDeckMutation.mutate({
                      id: deck.id,
                      name: editingDeckName,
                      daily_limit: editingDeckLimit.trim() === "" ? null : Number(editingDeckLimit),
                    })
                  }
                >
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
              <span className="text-xs text-muted-foreground">{totalCardCount} card(s)</span>
              {deck.daily_limit != null && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  limite {deck.daily_limit}/dia
                </span>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Exportar deck (CSV)"
                  onClick={() => exportDeck(deck)}
                >
                  <Download className="size-3.5" />
                  <span className="sr-only">Exportar deck</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Editar deck"
                  onClick={() => {
                    setEditingDeckId(deck.id);
                    setEditingDeckName(deck.name);
                    setEditingDeckLimit(deck.daily_limit != null ? String(deck.daily_limit) : "");
                  }}
                >
                  <Pencil className="size-3.5" />
                  <span className="sr-only">Editar deck</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title="Excluir deck"
                  onClick={() => {
                    const deckIds = new Set(collectDeckIds(deck.id));
                    const count = cards.filter((c: any) => deckIds.has(c.deck_id)).length;
                    const ok = window.confirm(
                      `Excluir deck "${deck.name}"? Isso também removerá ${count} card(s) deste deck.`,
                    );
                    if (ok) removeDeck.mutate(deck.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Excluir deck</span>
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Render this deck's own cards only when expanded */}
        {isOpen &&
          (deckCards.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum card neste deck.</p>
          ) : (
            <ul className="space-y-3">{deckCards.map((card: any) => renderCardRow(card))}</ul>
          ))}

        {/* Render subdecks below, when expanded */}
        {children.length > 0 && isOpen && (
          <div className="mt-3 space-y-3 pl-6">
            {children.map((child) => (
              <div key={child.id}>{renderTreeNode(child, level + 1)}</div>
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
          </header>

          <main className="flex flex-1 justify-center p-3 sm:p-6">
            <div className="w-full max-w-3xl">
              <CardPreviewDialog
                card={previewCard}
                open={previewCard !== null}
                onOpenChange={(o) => {
                  if (!o) setPreviewCard(null);
                }}
                onSave={(updated) => {
                  const id = (previewCard as any)?.id;
                  if (!id) return;
                  updateMutation.mutate({ id, ...updated });
                  setPreviewCard((prev) => (prev ? { ...prev, ...updated } : prev));
                }}
              />
              {occlusionCard && (
                <ImageOcclusionEditor
                  imageUrl={occlusionCard.image_url}
                  regions={(occlusionCard.occlusion_regions ?? []).map((r: any) => ({
                    id: r.id,
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    label: r.label ?? "",
                  }))}
                  onClose={() => {
                    if (!savingOcclusion) setOcclusionCard(null);
                  }}
                  onApply={({ file, regions: newRegions }) => {
                    void handleOcclusionSave(file, newRegions);
                  }}
                />
              )}
              {decksLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : decks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Nenhum deck ainda.
                </p>
              ) : cardsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Buscar em perguntas, respostas e decks..."
                      className="pl-9 pr-9"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-4" />
                        <span className="sr-only">Limpar busca</span>
                      </button>
                    )}
                  </div>

                  {searchResults ? (
                    searchResults.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        Nenhum card encontrado para "{query}".
                      </p>
                    ) : (
                      <div className="rounded-xl border border-border bg-card p-3">
                        <p className="mb-3 text-xs text-muted-foreground">
                          {searchResults.length} card(s) encontrado(s)
                        </p>
                        <ul className="space-y-3">
                          {searchResults.map((card: any) => renderCardRow(card))}
                        </ul>
                      </div>
                    )
                  ) : (
                    roots.map((root) => <div key={root.id}>{renderTreeNode(root)}</div>)
                  )}
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
