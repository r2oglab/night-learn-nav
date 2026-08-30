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
  BookOpen,
  Copy,
  CheckSquare,
  Square,
  Undo2,
  FolderInput,
  Star,
  ArrowUp,
  ArrowDown,
  FolderPlus,
} from "lucide-react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  listDecks,
  createDeck,
  deleteDeck,
  updateDeck,
  setDeckPinned,
  reorderDecks,
  listTrashedDecks,
  restoreDeck,
  permanentlyDeleteDeck,
} from "@/lib/decks.functions";
import { compareDecks } from "@/lib/deck-tree";
import {
  listCards,
  deleteCard,
  updateCard,
  updateCardTags,
  updateCardNote,
  updateImageOcclusion,
  postponeCard,
  setCardSuspended,
  duplicateCard,
  bulkMoveCards,
  bulkSetSuspended,
  bulkDeleteCards,
  listTrashedCards,
  restoreCard,
  permanentlyDeleteCard,
  listCardEditLogs,
  linkCards,
  unlinkCards,
  listCardLinks,
  previewFindReplace,
  applyFindReplace,
} from "@/lib/cards.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { CardPreviewDialog, type PreviewCard } from "@/components/card-preview-dialog";
import { buildCardsCsv, downloadTextFile } from "@/lib/csv-export";
import { ImageOcclusionEditor, type RegionDraft } from "@/components/image-occlusion-editor";
import ReviewSession from "@/components/review-session";
import type { DeckRow } from "@/lib/deck-tree";
import { isLeech, LEECH_THRESHOLD } from "@/lib/leech";
import { TagInput } from "@/components/tag-input";
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
      void queryClient.invalidateQueries({ queryKey: ["trashedCards"] });
      toast.success("Card movido para a lixeira");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const duplicateServer = useServerFn(duplicateCard);
  const duplicateMutation = useMutation({
    mutationFn: (id: string) =>
      duplicateServer({ data: { id, tz_offset_minutes: new Date().getTimezoneOffset() } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success("Card duplicado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Bulk actions — a separate selection lens from the deck tree/search/tag
  // filters above, same "one mode at a time" idea.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  const bulkMoveServer = useServerFn(bulkMoveCards);
  const bulkMoveMutation = useMutation({
    mutationFn: (vars: { ids: string[]; deck_id: string }) => bulkMoveServer({ data: vars }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success(`${res.count} card(s) movido(s)`);
      exitSelectionMode();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkSuspendServer = useServerFn(bulkSetSuspended);
  const bulkSuspendMutation = useMutation({
    mutationFn: (vars: { ids: string[]; suspended: boolean }) => bulkSuspendServer({ data: vars }),
    onSuccess: (res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success(`${res.count} card(s) ${vars.suspended ? "suspenso(s)" : "reativado(s)"}`);
      exitSelectionMode();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkDeleteServer = useServerFn(bulkDeleteCards);
  const bulkDeleteMutation = useMutation({
    mutationFn: (vars: { ids: string[] }) => bulkDeleteServer({ data: vars }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["trashedCards"] });
      toast.success(`${res.count} card(s) movido(s) para a lixeira`);
      exitSelectionMode();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Trash — a whole separate view, not another lens on the same list, since
  // it reads from its own query (listCards never returns trashed cards).
  const [showTrash, setShowTrash] = useState(false);
  const fetchTrashed = useServerFn(listTrashedCards);
  const { data: trashedCards = [], isLoading: trashLoading } = useQuery({
    queryKey: ["trashedCards"],
    queryFn: () => fetchTrashed(),
    enabled: showTrash,
  });

  const restoreServer = useServerFn(restoreCard);
  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreServer({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["trashedCards"] });
      toast.success("Card restaurado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const permanentDeleteServer = useServerFn(permanentlyDeleteCard);
  const permanentDeleteMutation = useMutation({
    mutationFn: (id: string) => permanentDeleteServer({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trashedCards"] });
      toast.success("Card excluído permanentemente");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const fetchTrashedDecks = useServerFn(listTrashedDecks);
  const { data: trashedDecks = [], isLoading: trashedDecksLoading } = useQuery({
    queryKey: ["trashedDecks"],
    queryFn: () => fetchTrashedDecks(),
    enabled: showTrash,
  });

  const restoreDeckServer = useServerFn(restoreDeck);
  const restoreDeckMutation = useMutation({
    mutationFn: (id: string) => restoreDeckServer({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["trashedDecks"] });
      void queryClient.invalidateQueries({ queryKey: ["trashedCards"] });
      toast.success("Deck restaurado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const permanentDeleteDeckServer = useServerFn(permanentlyDeleteDeck);
  const permanentDeleteDeckMutation = useMutation({
    mutationFn: (id: string) => permanentDeleteDeckServer({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trashedDecks"] });
      void queryClient.invalidateQueries({ queryKey: ["trashedCards"] });
      toast.success("Deck excluído permanentemente");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createDeckServer = useServerFn(createDeck);
  const createDeckMutation = useMutation({
    mutationFn: (path: string) => createDeckServer({ data: { path } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      toast.success("Deck criado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeDeckServer = useServerFn(deleteDeck);
  const removeDeck = useMutation({
    mutationFn: (id: string) => removeDeckServer({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["trashedDecks"] });
      void queryClient.invalidateQueries({ queryKey: ["trashedCards"] });
      toast.success("Deck movido para a lixeira");
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
  const [editingDeckNewLimit, setEditingDeckNewLimit] = useState("");
  const [editingDeckExamDate, setEditingDeckExamDate] = useState("");

  const updateDeckServer = useServerFn(updateDeck);
  const updateDeckMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      name: string;
      daily_limit?: number | null;
      daily_new_limit?: number | null;
      exam_date?: string | null;
    }) => updateDeckServer({ data: vars }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      setEditingDeckId(null);
      setEditingDeckName("");
      toast.success("Deck atualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const pinDeckServer = useServerFn(setDeckPinned);
  const pinDeckMutation = useMutation({
    mutationFn: (vars: { id: string; pinned: boolean }) => pinDeckServer({ data: vars }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["decks"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderDecksServer = useServerFn(reorderDecks);
  const reorderMutation = useMutation({
    mutationFn: (vars: { orders: { id: string; sort_order: number }[] }) =>
      reorderDecksServer({ data: vars }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["decks"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  /** Moves a deck up/down among its siblings (same parent) by recomputing
   * sequential sort_order for the whole sibling group in current display
   * order, then swapping the two that moved. */
  function moveDeck(deck: DeckRow, direction: -1 | 1) {
    const siblings = childrenMap[deck.parent_id ?? "__root"] ?? [];
    const index = siblings.findIndex((d) => d.id === deck.id);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) return;

    const reordered = siblings.map((d, i) => ({ id: d.id, sort_order: i }));
    const current = reordered[index];
    const target = reordered[targetIndex];
    if (!current || !target) return;
    const tmp = current.sort_order;
    current.sort_order = target.sort_order;
    target.sort_order = tmp;
    reorderMutation.mutate({ orders: reordered });
  }

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

  const updateTagsServer = useServerFn(updateCardTags);
  const updateTagsMutation = useMutation({
    mutationFn: (vars: { id: string; tags: string[] }) => updateTagsServer({ data: vars }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateNoteServer = useServerFn(updateCardNote);
  const updateNoteMutation = useMutation({
    mutationFn: (vars: { id: string; note: string }) => updateNoteServer({ data: vars }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success("Nota salva");
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteDraft, setEditingNoteDraft] = useState("");

  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const fetchCardHistory = useServerFn(listCardEditLogs);
  const { data: cardHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ["cardEditLogs", viewingHistoryId],
    queryFn: () => fetchCardHistory({ data: { card_id: viewingHistoryId as string } }),
    enabled: !!viewingHistoryId,
  });

  const [editingLinksId, setEditingLinksId] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const fetchCardLinks = useServerFn(listCardLinks);
  const { data: cardLinks = [] } = useQuery({
    queryKey: ["cardLinks", editingLinksId],
    queryFn: () => fetchCardLinks({ data: { card_id: editingLinksId as string } }),
    enabled: !!editingLinksId,
  });
  const linkServer = useServerFn(linkCards);
  const linkMutation = useMutation({
    mutationFn: (vars: { card_id_a: string; card_id_b: string }) => linkServer({ data: vars }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cardLinks"] });
      setLinkSearch("");
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const unlinkServer = useServerFn(unlinkCards);
  const unlinkMutation = useMutation({
    mutationFn: (vars: { card_id_a: string; card_id_b: string }) => unlinkServer({ data: vars }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cardLinks"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  // Busca e substituição em lote — painel próprio, fora da árvore/lentes de
  // filtro (leech/tag/busca), já que opera sobre todos os cards de uma vez.
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [frFind, setFrFind] = useState("");
  const [frReplace, setFrReplace] = useState("");
  const [frCaseSensitive, setFrCaseSensitive] = useState(false);
  const previewFrServer = useServerFn(previewFindReplace);
  const previewFrMutation = useMutation({
    mutationFn: (vars: { find: string; case_sensitive: boolean }) =>
      previewFrServer({ data: vars }),
    onError: (err: Error) => toast.error(err.message),
  });
  const applyFrServer = useServerFn(applyFindReplace);
  const applyFrMutation = useMutation({
    mutationFn: (vars: { find: string; replace: string; case_sensitive: boolean }) =>
      applyFrServer({ data: vars }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success(`${res.count} card(s) atualizado(s)`);
      previewFrMutation.reset();
      setFrFind("");
      setFrReplace("");
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
  for (const pid of Object.keys(childrenMap)) {
    childrenMap[pid]?.sort(compareDecks);
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

  // Estudo livre: mesma lógica de rootDeckName/level1SubdeckName que a
  // Revisões usa pra agrupar o resumo final da sessão.
  function findRootDeckName(deckId?: string | null): string {
    if (!deckId) return "(sem deck)";
    let cur: DeckRow | undefined = deckById[deckId];
    if (!cur) return "(sem deck)";
    while (cur && cur.parent_id) cur = deckById[cur.parent_id];
    return cur?.name ?? "(sem deck)";
  }

  function findLevel1SubdeckName(deckId?: string | null): string | null {
    if (!deckId) return null;
    const chain: DeckRow[] = [];
    let cur: DeckRow | undefined = deckById[deckId];
    while (cur) {
      chain.push(cur);
      if (!cur.parent_id) break;
      cur = deckById[cur.parent_id];
    }
    if (chain.length < 2) return null;
    const level1 = chain[chain.length - 2];
    return level1 ? level1.name : null;
  }

  const [studySessionCards, setStudySessionCards] = useState<any[] | null>(null);
  const [studySessionMode, setStudySessionMode] = useState<"free" | "exam" | "read" | null>(null);
  const [showLeechesOnly, setShowLeechesOnly] = useState(false);
  const leechCards = cards.filter((c) => isLeech(c));
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const allTags = Array.from(new Set(cards.flatMap((c) => (c.tags ?? []) as string[]))).sort();
  const tagFilteredCards = activeTagFilter
    ? cards.filter((c) => ((c.tags ?? []) as string[]).includes(activeTagFilter))
    : [];
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);

  function toggleTagFilter(tag: string) {
    setShowLeechesOnly(false);
    setActiveTagFilter((prev) => (prev === tag ? null : tag));
  }

  /** Cards do deck (e subdecks), respeitando o filtro de tag ativo e
   * pulando suspensos — a base compartilhada pelos três modos de sessão. */
  function buildDeckSubset(deck: DeckRow) {
    const ids = new Set(collectDeckIds(deck.id));
    return cards
      .filter(
        (c: any) =>
          ids.has(c.deck_id) &&
          !c.suspended &&
          (!activeTagFilter || ((c.tags ?? []) as string[]).includes(activeTagFilter)),
      )
      .map((c: any) => ({
        ...c,
        rootDeckName: findRootDeckName(c.deck_id),
        level1SubdeckName: findLevel1SubdeckName(c.deck_id),
        occlusion_regions: Array.isArray(c.occlusion_regions) ? c.occlusion_regions : null,
      }));
  }

  function shuffled<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  }

  /** Estuda um deck (e subdecks) sem tocar no agendamento do FSRS. Respeita
   * o filtro de tag ativo, se houver um, além do deck escolhido. */
  function startFreeStudy(deck: DeckRow) {
    const subset = buildDeckSubset(deck);
    if (subset.length === 0) {
      toast.info("Nenhum card neste deck.");
      return;
    }
    setStudySessionCards(subset);
    setStudySessionMode("free");
  }

  /** Folheia pergunta+resposta do deck em sequência, sem nota nem FSRS —
   * pra rever conteúdo antes de uma aula, não pra testar retenção. */
  function startReadMode(deck: DeckRow) {
    const subset = buildDeckSubset(deck);
    if (subset.length === 0) {
      toast.info("Nenhum card neste deck.");
      return;
    }
    setStudySessionCards(subset);
    setStudySessionMode("read");
  }

  /** Prova simulada: mesmo mecanismo do estudo livre, mas embaralhado —
   * pra simular a ordem imprevisível de uma prova de verdade. */
  function startExamMode(deck: DeckRow) {
    const subset = shuffled(buildDeckSubset(deck));
    if (subset.length === 0) {
      toast.info("Nenhum card neste deck.");
      return;
    }
    setStudySessionCards(subset);
    setStudySessionMode("exam");
  }

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
              {selectionMode && (
                <button
                  type="button"
                  onClick={() => toggleSelected(card.id)}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  {selectedIds.has(card.id) ? (
                    <CheckSquare className="size-4 text-primary" />
                  ) : (
                    <Square className="size-4" />
                  )}
                  <span className="sr-only">Selecionar card</span>
                </button>
              )}
              {card.image_url && !card.occlusion_target_id && (
                <img
                  src={card.image_url}
                  alt=""
                  className="size-14 shrink-0 rounded-md border border-border object-cover"
                />
              )}
              <div className="min-w-0 flex-1 break-words">
                {card.suspended && (
                  <span className="mb-1 mr-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    Suspenso
                  </span>
                )}
                {isLeech(card) && (
                  <span className="mb-1 inline-block rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] uppercase text-destructive">
                    Leech · {card.lapses}
                  </span>
                )}
                <div className="mb-1 flex flex-wrap items-center gap-1">
                  {((card.tags ?? []) as string[]).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTagFilter(tag)}
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        activeTagFilter === tag
                          ? "bg-sky-500 text-white"
                          : "bg-sky-500/15 text-sky-400 hover:bg-sky-500/25",
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEditingTagsId(editingTagsId === card.id ? null : card.id)}
                    className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {editingTagsId === card.id ? "fechar" : "+ tag"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (editingNoteId === card.id) {
                        setEditingNoteId(null);
                      } else {
                        setEditingNoteId(card.id);
                        setEditingNoteDraft(card.note ?? "");
                      }
                    }}
                    className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {editingNoteId === card.id
                      ? "fechar nota"
                      : card.note
                        ? "editar nota"
                        : "+ nota"}
                  </button>
                  {card.note && editingNoteId !== card.id && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500">
                      tem nota
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setViewingHistoryId(viewingHistoryId === card.id ? null : card.id)
                    }
                    className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {viewingHistoryId === card.id ? "fechar histórico" : "histórico"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLinksId(editingLinksId === card.id ? null : card.id);
                      setLinkSearch("");
                    }}
                    className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {editingLinksId === card.id ? "fechar relacionados" : "relacionados"}
                  </button>
                </div>
                {editingTagsId === card.id && (
                  <div className="mb-2 max-w-xs">
                    <TagInput
                      tags={(card.tags ?? []) as string[]}
                      onChange={(next) => updateTagsMutation.mutate({ id: card.id, tags: next })}
                    />
                  </div>
                )}
                {editingLinksId === card.id && (
                  <div className="mb-2 max-w-sm rounded-md border border-border bg-muted/20 p-2 text-xs">
                    {cardLinks.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {cardLinks.map((linked) => (
                          <span
                            key={linked.id}
                            className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-400"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                const full = cards.find((c) => c.id === linked.id);
                                setPreviewCard(full ?? linked);
                              }}
                              className="max-w-[160px] truncate hover:underline"
                              title={linked.pergunta}
                            >
                              {linked.pergunta}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                unlinkMutation.mutate({ card_id_a: card.id, card_id_b: linked.id })
                              }
                              className="hover:text-foreground"
                            >
                              <X className="size-3" />
                              <span className="sr-only">Desvincular</span>
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <Input
                      value={linkSearch}
                      onChange={(e) => setLinkSearch(e.target.value)}
                      placeholder="Buscar card pra relacionar..."
                      className="h-7 text-xs"
                    />
                    {linkSearch.trim().length >= 2 && (
                      <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                        {cards
                          .filter(
                            (c) =>
                              c.id !== card.id &&
                              !cardLinks.some((l) => l.id === c.id) &&
                              c.pergunta.toLowerCase().includes(linkSearch.trim().toLowerCase()),
                          )
                          .slice(0, 5)
                          .map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  linkMutation.mutate({ card_id_a: card.id, card_id_b: c.id })
                                }
                                className="w-full truncate rounded px-1.5 py-1 text-left hover:bg-muted"
                              >
                                {c.pergunta}
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
                {viewingHistoryId === card.id && (
                  <div className="mb-2 max-w-sm rounded-md border border-border bg-muted/20 p-2 text-xs">
                    {historyLoading ? (
                      <p className="text-muted-foreground">Carregando...</p>
                    ) : cardHistory.length === 0 ? (
                      <p className="text-muted-foreground">
                        Nenhuma edição de pergunta/resposta registrada ainda.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {cardHistory.map((entry) => (
                          <li key={entry.id} className="border-b border-border pb-2 last:border-0">
                            <p className="text-muted-foreground">
                              {new Date(entry.edited_at).toLocaleString("pt-BR")}
                            </p>
                            <p className="mt-1">
                              <span className="text-muted-foreground">antes: </span>
                              {entry.previous_pergunta}
                            </p>
                            <p>
                              <span className="text-muted-foreground">depois: </span>
                              {entry.new_pergunta}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {editingNoteId === card.id && (
                  <div className="mb-2 flex max-w-sm flex-col gap-1.5">
                    <textarea
                      value={editingNoteDraft}
                      onChange={(e) => setEditingNoteDraft(e.target.value)}
                      placeholder="Mnemônico, lembrete... só você vê isso, nunca aparece na revisão"
                      rows={3}
                      className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-primary"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={updateNoteMutation.isPending}
                        onClick={() => {
                          updateNoteMutation.mutate({ id: card.id, note: editingNoteDraft });
                          setEditingNoteId(null);
                        }}
                      >
                        Salvar nota
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingNoteId(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
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
              {card.image_url && card.occlusion_target_id ? (
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
                title="Duplicar card"
                disabled={duplicateMutation.isPending}
                onClick={() => duplicateMutation.mutate(card.id)}
              >
                <Copy className="size-3.5" />
                <span className="sr-only">Duplicar card</span>
              </Button>
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
    const subtreeIds = new Set(collectDeckIds(deck.id));
    const subtreeCardIds = cards.filter((c) => subtreeIds.has(c.deck_id)).map((c) => c.id);
    const subtreeAllSelected =
      subtreeCardIds.length > 0 && subtreeCardIds.every((id) => selectedIds.has(id));
    const siblings = childrenMap[deck.parent_id ?? "__root"] ?? [];
    const siblingIndex = siblings.findIndex((d) => d.id === deck.id);

    function toggleSubtreeSelected() {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of subtreeCardIds) {
          if (subtreeAllSelected) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    }

    return (
      <section key={deck.id} className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 sm:gap-3">
          <Button size="sm" variant="ghost" onClick={() => toggle(deck.id)}>
            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>

          {selectionMode && (
            <button
              type="button"
              disabled={subtreeCardIds.length === 0}
              onClick={toggleSubtreeSelected}
              title={
                subtreeAllSelected
                  ? "Desmarcar todos os cards deste deck (e subdecks)"
                  : "Selecionar todos os cards deste deck (e subdecks)"
              }
              className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              {subtreeAllSelected ? (
                <CheckSquare className="size-4 text-primary" />
              ) : (
                <Square className="size-4" />
              )}
              <span className="sr-only">Selecionar deck</span>
            </button>
          )}

          {editingDeckId === deck.id ? (
            <div className="flex w-full flex-wrap items-end gap-2">
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                Nome
                <Input
                  value={editingDeckName}
                  onChange={(e) => setEditingDeckName(e.target.value)}
                />
              </label>
              <label className="flex w-32 flex-col gap-1 text-xs text-muted-foreground">
                Limite/dia
                <Input
                  type="number"
                  min={0}
                  value={editingDeckLimit}
                  onChange={(e) => setEditingDeckLimit(e.target.value)}
                  placeholder="Sem limite"
                />
              </label>
              <label className="flex w-32 flex-col gap-1 text-xs text-muted-foreground">
                Novos/dia
                <Input
                  type="number"
                  min={0}
                  value={editingDeckNewLimit}
                  onChange={(e) => setEditingDeckNewLimit(e.target.value)}
                  placeholder="Sem limite"
                />
              </label>
              <label className="flex w-40 flex-col gap-1 text-xs text-muted-foreground">
                Data da prova
                <Input
                  type="date"
                  value={editingDeckExamDate}
                  onChange={(e) => setEditingDeckExamDate(e.target.value)}
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
                      daily_new_limit:
                        editingDeckNewLimit.trim() === "" ? null : Number(editingDeckNewLimit),
                      exam_date: editingDeckExamDate.trim() === "" ? null : editingDeckExamDate,
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
              <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={deck.name}>
                {deck.name}
              </h3>
              <span className="shrink-0 text-xs text-muted-foreground">
                {totalCardCount} card(s)
              </span>
              {deck.daily_limit != null && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  limite {deck.daily_limit}/dia
                </span>
              )}
              {deck.exam_date &&
                (() => {
                  const diffDays = Math.ceil(
                    (new Date(`${deck.exam_date}T00:00:00`).getTime() - Date.now()) /
                      (1000 * 60 * 60 * 24),
                  );
                  const label =
                    diffDays < 0
                      ? "prova passou"
                      : diffDays === 0
                        ? "prova hoje"
                        : `prova em ${diffDays}d`;
                  return (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                        diffDays <= 3 && diffDays >= 0
                          ? "bg-destructive/15 text-destructive"
                          : "bg-amber-500/15 text-amber-500",
                      )}
                    >
                      {label}
                    </span>
                  );
                })()}
              <div className="ml-auto flex shrink-0 flex-wrap items-center gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Mover pra cima"
                  disabled={siblingIndex <= 0}
                  onClick={() => moveDeck(deck, -1)}
                >
                  <ArrowUp className="size-3.5" />
                  <span className="sr-only">Mover pra cima</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Mover pra baixo"
                  disabled={siblingIndex === -1 || siblingIndex >= siblings.length - 1}
                  onClick={() => moveDeck(deck, 1)}
                >
                  <ArrowDown className="size-3.5" />
                  <span className="sr-only">Mover pra baixo</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Criar subdeck aqui dentro"
                  disabled={createDeckMutation.isPending}
                  onClick={() => {
                    const name = window.prompt(`Nome da subdeck dentro de "${deck.name}":`);
                    if (name?.trim()) {
                      createDeckMutation.mutate(`${getPath(deck.id)}::${name.trim()}`);
                    }
                  }}
                >
                  <FolderPlus className="size-3.5" />
                  <span className="sr-only">Criar subdeck</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title={deck.pinned ? "Desafixar" : "Fixar no topo"}
                  disabled={pinDeckMutation.isPending}
                  onClick={() => pinDeckMutation.mutate({ id: deck.id, pinned: !deck.pinned })}
                >
                  <Star className={cn("size-3.5", deck.pinned && "fill-current text-primary")} />
                  <span className="sr-only">{deck.pinned ? "Desafixar" : "Fixar no topo"}</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      title="Modos de estudo sem agendamento"
                    >
                      <BookOpen className="size-3.5" />
                      <span className="sr-only">Modos de estudo</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => startFreeStudy(deck)}>
                      Estudar livre
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => startExamMode(deck)}>
                      Prova simulada
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => startReadMode(deck)}>
                      Modo leitura
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Exportar deck (CSV) — pra compartilhar com o grupo ou fazer backup"
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
                    setEditingDeckNewLimit(
                      deck.daily_new_limit != null ? String(deck.daily_new_limit) : "",
                    );
                    setEditingDeckExamDate(deck.exam_date ?? "");
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
      <div className="flex min-h-screen w-full overflow-x-hidden bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Flashcards</h1>
          </header>

          <main className="flex flex-1 justify-center p-3 sm:p-6">
            <div className="w-full min-w-0 max-w-3xl">
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
              {studySessionMode && studySessionCards && (
                <div className="fixed inset-0 z-50">
                  <ReviewSession
                    cards={studySessionCards}
                    freeMode
                    examMode={studySessionMode === "exam"}
                    readOnly={studySessionMode === "read"}
                    onExit={() => setStudySessionMode(null)}
                    onComplete={() => setStudySessionMode(null)}
                  />
                </div>
              )}
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={createDeckMutation.isPending}
                  onClick={() => {
                    const name = window.prompt(
                      "Nome do novo deck (use :: pra criar como subdeck de outro, ex: Módulo::Assunto):",
                    );
                    if (name?.trim()) createDeckMutation.mutate(name.trim());
                  }}
                >
                  + Novo deck
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={selectionMode ? "default" : "outline"}
                    onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
                  >
                    {selectionMode ? "Cancelar seleção" : "Selecionar"}
                  </Button>
                  <Button
                    size="sm"
                    variant={showTrash ? "default" : "outline"}
                    onClick={() => setShowTrash((v) => !v)}
                  >
                    {showTrash ? "Voltar" : "Lixeira"}
                  </Button>
                  <Button
                    size="sm"
                    variant={showFindReplace ? "default" : "outline"}
                    onClick={() => setShowFindReplace((v) => !v)}
                  >
                    {showFindReplace ? "Fechar busca/substituição" : "Buscar e substituir"}
                  </Button>
                </div>
              </div>
              {showFindReplace && (
                <div className="mb-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={frFind}
                      onChange={(e) => setFrFind(e.target.value)}
                      placeholder="Buscar..."
                      className="h-8 max-w-xs text-sm"
                    />
                    <Input
                      value={frReplace}
                      onChange={(e) => setFrReplace(e.target.value)}
                      placeholder="Substituir por..."
                      className="h-8 max-w-xs text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={frCaseSensitive}
                        onChange={(e) => setFrCaseSensitive(e.target.checked)}
                      />
                      Diferenciar maiúsc./minúsc.
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!frFind.trim() || previewFrMutation.isPending}
                      onClick={() =>
                        previewFrMutation.mutate({ find: frFind, case_sensitive: frCaseSensitive })
                      }
                    >
                      Buscar
                    </Button>
                    {previewFrMutation.data && (
                      <>
                        <span className="text-xs text-muted-foreground">
                          {previewFrMutation.data.length} card(s) encontrado(s)
                        </span>
                        {previewFrMutation.data.length > 0 && (
                          <Button
                            size="sm"
                            disabled={applyFrMutation.isPending}
                            onClick={() => {
                              const ok = window.confirm(
                                `Substituir em ${previewFrMutation.data.length} card(s)? Fica registrado no histórico de cada um.`,
                              );
                              if (ok) {
                                applyFrMutation.mutate({
                                  find: frFind,
                                  replace: frReplace,
                                  case_sensitive: frCaseSensitive,
                                });
                              }
                            }}
                          >
                            Substituir tudo
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {previewFrMutation.data && previewFrMutation.data.length > 0 && (
                    <ul className="max-h-48 space-y-1.5 overflow-y-auto border-t border-border pt-2">
                      {previewFrMutation.data.slice(0, 10).map((c) => (
                        <li
                          key={c.id}
                          className="truncate rounded-md bg-background px-2.5 py-1.5 text-sm"
                          title={c.pergunta}
                        >
                          {c.pergunta}
                        </li>
                      ))}
                      {previewFrMutation.data.length > 10 && (
                        <li className="px-2.5 py-1 text-xs text-muted-foreground">
                          ...e mais {previewFrMutation.data.length - 10}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
              {showTrash ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Decks e cards excluídos ficam aqui por 30 dias antes de sumir de vez. Restaurar
                    um deck também restaura os cards que foram junto com ele — cards que já estavam
                    na lixeira antes disso continuam lá.
                  </p>
                  {trashedDecksLoading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : trashedDecks.length > 0 ? (
                    <ul className="space-y-3 rounded-xl border border-border bg-card p-3">
                      {trashedDecks.map((deck) => (
                        <li
                          key={deck.id}
                          className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium" title={deck.name}>
                              {deck.name}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              title="Restaurar deck"
                              disabled={restoreDeckMutation.isPending}
                              onClick={() => restoreDeckMutation.mutate(deck.id)}
                            >
                              <Undo2 className="size-3.5" />
                              <span className="sr-only">Restaurar deck</span>
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              title="Excluir permanentemente"
                              disabled={permanentDeleteDeckMutation.isPending}
                              onClick={() => {
                                const ok = window.confirm(
                                  `Excluir "${deck.name}" e todos os cards dele permanentemente? Isso não pode ser desfeito.`,
                                );
                                if (ok) permanentDeleteDeckMutation.mutate(deck.id);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                              <span className="sr-only">Excluir permanentemente</span>
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {trashLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : trashedCards.length === 0 ? (
                    trashedDecks.length === 0 && (
                      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        Lixeira vazia.
                      </p>
                    )
                  ) : (
                    <ul className="space-y-3 rounded-xl border border-border bg-card p-3">
                      {trashedCards.map((card) => (
                        <li
                          key={card.id}
                          className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                        >
                          <div className="min-w-0 flex-1 break-words">
                            <p className="font-medium">{card.pergunta}</p>
                            <p className="text-sm text-muted-foreground">{card.resposta}</p>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {getPath(card.deck_id)}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              title="Restaurar"
                              disabled={restoreMutation.isPending}
                              onClick={() => restoreMutation.mutate(card.id)}
                            >
                              <Undo2 className="size-3.5" />
                              <span className="sr-only">Restaurar</span>
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              title="Excluir permanentemente"
                              disabled={permanentDeleteMutation.isPending}
                              onClick={() => {
                                const ok = window.confirm(
                                  `Excluir "${card.pergunta}" permanentemente? Isso não pode ser desfeito.`,
                                );
                                if (ok) permanentDeleteMutation.mutate(card.id);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                              <span className="sr-only">Excluir permanentemente</span>
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : decksLoading ? (
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
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
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
                    <Button
                      size="sm"
                      variant={showLeechesOnly ? "default" : "outline"}
                      className="h-9 shrink-0"
                      title={`Cards com ${LEECH_THRESHOLD}+ erros consecutivos`}
                      onClick={() => {
                        setActiveTagFilter(null);
                        setShowLeechesOnly((v) => !v);
                      }}
                    >
                      Leeches ({leechCards.length})
                    </Button>
                  </div>

                  {selectionMode && selectedIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
                      <span className="text-xs text-muted-foreground">
                        {selectedIds.size} selecionado(s)
                      </span>
                      <select
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                        defaultValue=""
                        onChange={(e) => {
                          const deckId = e.target.value;
                          if (!deckId) return;
                          bulkMoveMutation.mutate({
                            ids: Array.from(selectedIds),
                            deck_id: deckId,
                          });
                          e.target.value = "";
                        }}
                      >
                        <option value="" disabled>
                          Mover para...
                        </option>
                        {decks.map((d) => (
                          <option key={d.id} value={d.id}>
                            {getPath(d.id)}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={bulkSuspendMutation.isPending}
                        onClick={() =>
                          bulkSuspendMutation.mutate({
                            ids: Array.from(selectedIds),
                            suspended: true,
                          })
                        }
                      >
                        Suspender
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={bulkSuspendMutation.isPending}
                        onClick={() =>
                          bulkSuspendMutation.mutate({
                            ids: Array.from(selectedIds),
                            suspended: false,
                          })
                        }
                      >
                        Reativar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={bulkDeleteMutation.isPending}
                        onClick={() => {
                          const ok = window.confirm(
                            `Excluir ${selectedIds.size} card(s)? Vão para a lixeira.`,
                          );
                          if (ok) bulkDeleteMutation.mutate({ ids: Array.from(selectedIds) });
                        }}
                      >
                        Excluir
                      </Button>
                    </div>
                  )}

                  {allTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {allTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTagFilter(tag)}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs",
                            activeTagFilter === tag
                              ? "bg-sky-500 text-white"
                              : "bg-sky-500/15 text-sky-400 hover:bg-sky-500/25",
                          )}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}

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
                  ) : showLeechesOnly ? (
                    leechCards.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        Nenhum leech — nenhum card com {LEECH_THRESHOLD}+ erros ainda.
                      </p>
                    ) : (
                      <div className="rounded-xl border border-border bg-card p-3">
                        <p className="mb-3 text-xs text-muted-foreground">
                          {leechCards.length} card(s) com {LEECH_THRESHOLD}+ erros consecutivos
                        </p>
                        <ul className="space-y-3">
                          {leechCards.map((card) => renderCardRow(card))}
                        </ul>
                      </div>
                    )
                  ) : activeTagFilter ? (
                    tagFilteredCards.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        Nenhum card com a tag "{activeTagFilter}".
                      </p>
                    ) : (
                      <div className="rounded-xl border border-border bg-card p-3">
                        <p className="mb-3 text-xs text-muted-foreground">
                          {tagFilteredCards.length} card(s) com a tag "{activeTagFilter}"
                        </p>
                        <ul className="space-y-3">
                          {tagFilteredCards.map((card) => renderCardRow(card))}
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