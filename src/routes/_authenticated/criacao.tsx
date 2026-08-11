import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Loader2, ClipboardPaste, Maximize2, Upload, Sparkles, Eye } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { createCard, createImageOcclusionCards, importCards } from "@/lib/cards.functions";
import { createDeck } from "@/lib/decks.functions";
import { generateCardsFromText } from "@/lib/ai.functions";
import { Textarea } from "@/components/ui/textarea";
import { CardPreviewDialog, type PreviewCard } from "@/components/card-preview-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageOcclusionEditor, type RegionDraft } from "@/components/image-occlusion-editor";
import { ClozeEditor, buildClozeText } from "@/components/cloze-editor";
import {
  parseCsv,
  detectDelimiter,
  rowsToCards,
  extractAnkiHeader,
  type ParsedCardRow,
} from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/criacao")({
  component: CriacaoPage,
});

type CardType = "simples" | "invertido" | "cloze" | "digitar" | "oclusao" | "importar" | "ia";

type DrawingRect = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function CriacaoPage() {
  const queryClient = useQueryClient();
  const addCard = useServerFn(createCard);
  const createNewDeck = useServerFn(createDeck);
  const createOcclusionCards = useServerFn(createImageOcclusionCards);

  const [deckPath, setDeckPath] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [cardType, setCardType] = useState<CardType>("simples");
  const invert = cardType === "invertido";
  const cloze = cardType === "cloze";
  const typeIn = cardType === "digitar";
  const [clozeText, setClozeText] = useState("");
  const [hiddenTokens, setHiddenTokens] = useState<Set<number>>(new Set());
  const hasHiddenWord = hiddenTokens.size > 0;

  function toggleClozeToken(i: number) {
    setHiddenTokens((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function buildClozeQuestion(): string {
    return buildClozeText(clozeText, hiddenTokens);
  }

  // Image occlusion state
  const [occlusionFile, setOcclusionFile] = useState<File | null>(null);
  const [occlusionImageUrl, setOcclusionImageUrl] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionDraft[]>([]);
  const [drawing, setDrawing] = useState<DrawingRect | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  // CSV import state
  const [csvPreview, setCsvPreview] = useState<ParsedCardRow[] | null>(null);
  const [csvSkipped, setCsvSkipped] = useState(0);
  const [csvHasHeader, setCsvHasHeader] = useState(true);
  const [csvDeckColumn, setCsvDeckColumn] = useState(false);
  const [csvRawRows, setCsvRawRows] = useState<string[][] | null>(null);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvTagsColumn, setCsvTagsColumn] = useState<number | null>(null);
  const [csvUseTagsAsDeck, setCsvUseTagsAsDeck] = useState(false);
  const [importing, setImporting] = useState(false);
  const runImport = useServerFn(importCards);

  // AI generation: proposals live in local state until the user accepts them,
  // so nothing reaches the deck without a look first.
  const runGenerate = useServerFn(generateCardsFromText);
  const [aiSource, setAiSource] = useState("");
  const [aiCount, setAiCount] = useState(12);
  const [aiProposals, setAiProposals] = useState<{ pergunta: string; resposta: string }[] | null>(
    null,
  );
  const [aiAccepted, setAiAccepted] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [previewCard, setPreviewCard] = useState<PreviewCard | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const result = await runGenerate({ data: { text: aiSource, count: aiCount } });
      setAiProposals(result.cards);
      // Everything starts checked: reviewing a list and unchecking the odd
      // one out is less work than ticking twelve good cards by hand.
      setAiAccepted(new Set(result.cards.map((_, i) => i)));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleAcceptGenerated(deck: string) {
    if (!aiProposals) return;
    const chosen = aiProposals.filter((_, i) => aiAccepted.has(i));
    if (chosen.length === 0) {
      toast.error("Selecione pelo menos um card.");
      return;
    }
    setGenerating(true);
    try {
      const result = await runImport({
        data: { cards: chosen.map((c) => ({ ...c, deckPath: deck })) },
      });
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      toast.success(`${result.imported} card(s) criado(s)`);
      setAiProposals(null);
      setAiAccepted(new Set());
      setAiSource("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }
  const imageAreaRef = useRef<HTMLDivElement>(null);

  const create = useMutation({
    mutationFn: (vars: {
      deck_id: string;
      pergunta: string;
      resposta?: string;
      invert?: boolean;
      cloze?: boolean;
      typeIn?: boolean;
    }) => addCard({ data: vars }),
    onSuccess: () => {
      setDeckPath("");
      setQuestion("");
      setAnswer("");
      setClozeText("");
      setHiddenTokens(new Set());
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      toast.success("Card adicionado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function loadImageFile(file: File) {
    setOcclusionFile(file);
    setOcclusionImageUrl(URL.createObjectURL(file));
    setRegions([]);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadImageFile(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (file) {
      e.preventDefault();
      loadImageFile(file);
    }
  }

  function getRelativePos(clientX: number, clientY: number): { x: number; y: number } {
    const rect = imageAreaRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }

  const drawAnchorRef = useRef<{ startX: number; startY: number } | null>(null);

  function handleMouseDown(e: React.MouseEvent) {
    const { x, y } = getRelativePos(e.clientX, e.clientY);
    drawAnchorRef.current = { startX: x, startY: y };
    setDrawing({ startX: x, startY: y, x, y, width: 0, height: 0 });
  }

  const isDrawing = drawing !== null;
  useEffect(() => {
    if (!isDrawing) return;
    function handleWindowMouseMove(e: MouseEvent) {
      const anchor = drawAnchorRef.current;
      if (!anchor) return;
      const { x, y } = getRelativePos(e.clientX, e.clientY);
      const newX = Math.min(x, anchor.startX);
      const newY = Math.min(y, anchor.startY);
      const width = Math.abs(x - anchor.startX);
      const height = Math.abs(y - anchor.startY);
      setDrawing({ startX: anchor.startX, startY: anchor.startY, x: newX, y: newY, width, height });
    }
    function handleWindowMouseUp() {
      setDrawing((current) => {
        if (current && current.width > 1 && current.height > 1) {
          const finished = current;
          setRegions((r) => [
            ...r,
            {
              id: crypto.randomUUID(),
              x: finished.x,
              y: finished.y,
              width: finished.width,
              height: finished.height,
              label: "",
            },
          ]);
        }
        return null;
      });
      drawAnchorRef.current = null;
    }
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDrawing]);

  function recomputeCsvPreview(
    rows: string[][],
    hasHeader: boolean,
    deckColumn: boolean,
    deck: string,
    tagsColumn?: number | null,
    useTagsAsDeck?: boolean,
  ) {
    const { cards, skipped } = rowsToCards(rows, {
      hasHeader,
      defaultDeck: deck.trim() || "Importados",
      deckColumnFirst: deckColumn,
      deckFromColumn:
        (useTagsAsDeck ?? csvUseTagsAsDeck) && (tagsColumn ?? csvTagsColumn)
          ? ((tagsColumn ?? csvTagsColumn) as number)
          : undefined,
    });
    setCsvPreview(cards);
    setCsvSkipped(skipped);
  }

  async function handleCsvFile(file: File) {
    const raw = await file.text();
    // Anki writes its own metadata block ("#separator:", "#deck:", ...)
    // above the data; honouring it means a straight Anki export needs no
    // manual setup at all.
    const { header, body } = extractAnkiHeader(raw);
    const delimiter = header.separator ?? detectDelimiter(body);
    const rows = parseCsv(body, delimiter);
    if (rows.length === 0) {
      toast.error("Arquivo vazio ou ilegível.");
      return;
    }

    // The header's own deck name wins over whatever is currently typed.
    let effectiveDeck = deckPath;
    if (header.deck) {
      effectiveDeck = header.deck;
      setDeckPath(header.deck);
    }
    const tagsCol = header.tagsColumn ?? null;
    setCsvTagsColumn(tagsCol);
    setCsvUseTagsAsDeck(false);
    // Having 3 columns does NOT imply the first one is a deck: Anki's own
    // export is "Front, Back, Tags", where the third column is the tag and
    // the deck isn't in the file at all. Guessing "deck first" there shifts
    // every field by one. Only assume a leading deck column when the first
    // cell actually looks like a deck path (contains "::") — otherwise the
    // safe default is question/answer, which the user can override.
    const firstDataRow = csvHasHeader ? rows[1] : rows[0];
    const looksLikeDeckColumn =
      !!firstDataRow && firstDataRow.length >= 3 && (firstDataRow[0] ?? "").includes("::");
    setCsvRawRows(rows);
    setCsvFileName(file.name);
    setCsvDeckColumn(looksLikeDeckColumn);
    recomputeCsvPreview(rows, csvHasHeader, looksLikeDeckColumn, effectiveDeck, tagsCol, false);
  }

  async function handleImportSubmit() {
    if (!csvPreview || csvPreview.length === 0) {
      toast.error("Nada para importar.");
      return;
    }
    setImporting(true);
    try {
      const result = await runImport({ data: { cards: csvPreview } });
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      toast.success(`${result.imported} card(s) importado(s) em ${result.decks} deck(s)`);
      setCsvPreview(null);
      setCsvRawRows(null);
      setCsvFileName("");
      setCsvSkipped(0);
      setCsvTagsColumn(null);
      setCsvUseTagsAsDeck(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  async function handlePasteButtonClick() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], `colado.${imageType.split("/")[1] || "png"}`, {
            type: imageType,
          });
          loadImageFile(file);
          return;
        }
      }
      toast.error("Nenhuma imagem encontrada na área de transferência.");
    } catch {
      toast.error("Não foi possível acessar a área de transferência. Tente Ctrl+V na área acima.");
    }
  }

  async function handleOcclusionSubmit(deck: string) {
    if (!occlusionFile) {
      toast.error("Envie uma imagem.");
      return;
    }
    if (regions.length === 0) {
      toast.error("Desenhe pelo menos uma área de oclusão.");
      return;
    }
    setUploading(true);
    try {
      const deckRow = await createNewDeck({ data: { path: deck } });
      if (!deckRow?.id) throw new Error("Não foi possível resolver/usar o deck.");

      const ext = occlusionFile.name.split(".").pop() || "png";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("card-images")
        .upload(path, occlusionFile);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("card-images").getPublicUrl(path);

      await createOcclusionCards({
        data: {
          deck_id: deckRow.id,
          image_url: urlData.publicUrl,
          regions: regions.map((r) => ({
            id: r.id,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            label: r.label.trim() || undefined,
          })),
        },
      });

      const count = regions.length;
      setDeckPath("");
      setOcclusionFile(null);
      setOcclusionImageUrl(null);
      setRegions([]);
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      toast.success(`${count} card(s) de oclusão criado(s)`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Criação</h1>
          </header>

          <main className="flex flex-1 justify-center p-3 sm:p-6">
            <div className="w-full max-w-3xl">
              <CardPreviewDialog
                card={previewCard}
                open={previewCard !== null}
                onOpenChange={(o) => {
                  if (!o) setPreviewCard(null);
                }}
              />
              {editorOpen && occlusionImageUrl && (
                <ImageOcclusionEditor
                  imageUrl={occlusionImageUrl}
                  regions={regions}
                  onClose={() => setEditorOpen(false)}
                  onApply={({ file, regions: newRegions }) => {
                    if (file) {
                      setOcclusionFile(file);
                      setOcclusionImageUrl(URL.createObjectURL(file));
                    }
                    setRegions(newRegions);
                    setEditorOpen(false);
                  }}
                />
              )}

              <form
                className="mb-6 grid gap-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  // Import carries a deck per row (or falls back to a default),
                  // so the deck field isn't required for it.
                  if (cardType === "importar") {
                    await handleImportSubmit();
                    return;
                  }

                  const deck = deckPath.trim();
                  if (cardType === "ia") {
                    // Generating needs no deck; only accepting the results does.
                    if (!aiProposals) {
                      await handleGenerate();
                      return;
                    }
                    if (!deck) {
                      toast.error("Informe o deck onde os cards serão criados.");
                      return;
                    }
                    await handleAcceptGenerated(deck);
                    return;
                  }

                  if (!deck) {
                    toast.error("Informe o caminho do deck (ex: Deck::Subdeck)");
                    return;
                  }

                  if (cardType === "oclusao") {
                    await handleOcclusionSubmit(deck);
                    return;
                  }

                  if (cloze) {
                    if (!clozeText.trim() || !hasHiddenWord) {
                      toast.error(
                        "Clique em pelo menos uma palavra da frase pra marcar como escondida.",
                      );
                      return;
                    }
                  } else if (!question.trim() || !answer.trim()) {
                    return;
                  }

                  try {
                    const deckRow = await createNewDeck({ data: { path: deck } });
                    if (!deckRow?.id) throw new Error("Não foi possível resolver/usar o deck.");
                    const pergunta = cloze ? buildClozeQuestion() : question.trim();
                    create.mutate({
                      deck_id: deckRow.id,
                      pergunta,
                      resposta: answer.trim(),
                      invert,
                      cloze,
                      typeIn,
                    });
                  } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {cardType === "importar"
                    ? "Deck padrão (usado quando a linha não traz o deck)"
                    : "Deck (use `::` para sub-decks)"}
                  <Input
                    value={deckPath}
                    onChange={(event) => {
                      setDeckPath(event.target.value);
                      if (cardType === "importar" && csvRawRows)
                        recomputeCsvPreview(
                          csvRawRows,
                          csvHasHeader,
                          csvDeckColumn,
                          event.target.value,
                          csvTagsColumn,
                          csvUseTagsAsDeck,
                        );
                    }}
                    placeholder={cardType === "importar" ? "Importados" : "Ex: Biologia::Genética"}
                  />
                </label>

                <RadioGroup
                  value={cardType}
                  onValueChange={(v) => setCardType(v as CardType)}
                  className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-4"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="simples" />
                    <span className="text-muted-foreground">Simples</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="invertido" />
                    <span className="text-muted-foreground">Cartão invertido</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="cloze" />
                    <span className="text-muted-foreground">Omissão de palavra (cloze)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="digitar" />
                    <span className="text-muted-foreground">Digitar a resposta</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="oclusao" />
                    <span className="text-muted-foreground">Oclusão de imagem</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="ia" />
                    <span className="text-muted-foreground">Gerar com IA</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="importar" />
                    <span className="text-muted-foreground">Importar CSV</span>
                  </label>
                </RadioGroup>

                {cardType === "ia" ? (
                  <div className="grid gap-3">
                    {!aiProposals ? (
                      <>
                        <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                          Conteúdo (aula, resumo, problema de PBL...)
                          <Textarea
                            value={aiSource}
                            onChange={(e) => setAiSource(e.target.value)}
                            placeholder="Cole aqui o texto que deve virar flashcards..."
                            className="min-h-40"
                          />
                        </label>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Quantos cards:</span>
                          <div className="flex flex-wrap gap-1">
                            {[5, 10, 15, 20, 30].map((n) => (
                              <Button
                                key={n}
                                type="button"
                                size="sm"
                                variant={aiCount === n ? "default" : "outline"}
                                onClick={() => setAiCount(n)}
                              >
                                {n}
                              </Button>
                            ))}
                          </div>
                          <Input
                            type="number"
                            min={1}
                            max={40}
                            value={aiCount}
                            onChange={(e) =>
                              setAiCount(Math.min(40, Math.max(1, Number(e.target.value) || 1)))
                            }
                            className="w-20"
                            aria-label="Quantidade personalizada"
                          />
                          <span className="text-xs text-muted-foreground">
                            {aiSource.trim().length} caracteres
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {aiAccepted.size} de {aiProposals.length} card(s) selecionado(s)
                          </span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="underline hover:text-foreground"
                              onClick={() => setAiAccepted(new Set(aiProposals.map((_, i) => i)))}
                            >
                              Selecionar todos
                            </button>
                            <button
                              type="button"
                              className="underline hover:text-foreground"
                              onClick={() => setAiAccepted(new Set())}
                            >
                              Limpar seleção
                            </button>
                            <button
                              type="button"
                              className="underline hover:text-foreground"
                              onClick={() => {
                                setAiProposals(null);
                                setAiAccepted(new Set());
                              }}
                            >
                              Gerar de novo
                            </button>
                          </div>
                        </div>

                        <ul className="space-y-2">
                          {aiProposals.map((card, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-3 rounded-lg border border-border p-3"
                            >
                              <Checkbox
                                checked={aiAccepted.has(i)}
                                onCheckedChange={(v) =>
                                  setAiAccepted((prev) => {
                                    const next = new Set(prev);
                                    if (v) next.add(i);
                                    else next.delete(i);
                                    return next;
                                  })
                                }
                                className="mt-1"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="mb-2 flex items-start gap-2">
                                  <Input
                                    value={card.pergunta}
                                    onChange={(e) =>
                                      setAiProposals((prev) =>
                                        (prev ?? []).map((c, j) =>
                                          j === i ? { ...c, pergunta: e.target.value } : c,
                                        ),
                                      )
                                    }
                                    className="font-medium"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0"
                                    onClick={() => setPreviewCard(card)}
                                  >
                                    <Eye className="size-3.5" />
                                    <span className="ml-1">Ver</span>
                                  </Button>
                                </div>
                                <Input
                                  value={card.resposta}
                                  onChange={(e) =>
                                    setAiProposals((prev) =>
                                      (prev ?? []).map((c, j) =>
                                        j === i ? { ...c, resposta: e.target.value } : c,
                                      ),
                                    )
                                  }
                                  className="text-muted-foreground"
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ) : cardType === "importar" ? (
                  <div className="grid gap-3">
                    {!csvPreview ? (
                      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        <p>Escolha um arquivo .csv ou .txt exportado do Anki, Excel ou similar</p>
                        <input
                          type="file"
                          accept=".csv,.txt,text/csv,text/plain"
                          className="text-xs"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleCsvFile(file);
                          }}
                        />
                        <p className="text-xs">
                          Formato aceito: 2 colunas (pergunta, resposta) ou 3 colunas (deck,
                          pergunta, resposta). Separador vírgula, ponto-e-vírgula ou tabulação —
                          detectado automaticamente.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            <span className="font-medium text-foreground">{csvFileName}</span> —{" "}
                            {csvPreview.length} card(s) prontos
                            {csvSkipped > 0 && `, ${csvSkipped} linha(s) ignorada(s)`}
                          </span>
                          <button
                            type="button"
                            className="text-muted-foreground underline hover:text-foreground"
                            onClick={() => {
                              setCsvPreview(null);
                              setCsvRawRows(null);
                              setCsvFileName("");
                              setCsvSkipped(0);
                              setCsvTagsColumn(null);
                              setCsvUseTagsAsDeck(false);
                            }}
                          >
                            Trocar arquivo
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-sm">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={csvHasHeader}
                              onChange={(e) => {
                                setCsvHasHeader(e.target.checked);
                                if (csvRawRows)
                                  recomputeCsvPreview(
                                    csvRawRows,
                                    e.target.checked,
                                    csvDeckColumn,
                                    deckPath,
                                  );
                              }}
                            />
                            <span className="text-muted-foreground">
                              Primeira linha é cabeçalho
                            </span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={csvDeckColumn}
                              onChange={(e) => {
                                setCsvDeckColumn(e.target.checked);
                                if (csvRawRows)
                                  recomputeCsvPreview(
                                    csvRawRows,
                                    csvHasHeader,
                                    e.target.checked,
                                    deckPath,
                                  );
                              }}
                            />
                            <span className="text-muted-foreground">Primeira coluna é o deck</span>
                          </label>
                          {csvTagsColumn && (
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={csvUseTagsAsDeck}
                                onChange={(e) => {
                                  setCsvUseTagsAsDeck(e.target.checked);
                                  if (csvRawRows)
                                    recomputeCsvPreview(
                                      csvRawRows,
                                      csvHasHeader,
                                      csvDeckColumn,
                                      deckPath,
                                      csvTagsColumn,
                                      e.target.checked,
                                    );
                                }}
                              />
                              <span className="text-muted-foreground">Usar tags como subdecks</span>
                            </label>
                          )}
                        </div>

                        {csvPreview.length > 0 && (
                          <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-left text-xs">
                              <thead className="border-b border-border text-muted-foreground">
                                <tr>
                                  <th className="p-2 font-medium">Deck</th>
                                  <th className="p-2 font-medium">Pergunta</th>
                                  <th className="p-2 font-medium">Resposta</th>
                                </tr>
                              </thead>
                              <tbody>
                                {csvPreview.slice(0, 5).map((c, i) => (
                                  <tr key={i} className="border-b border-border last:border-0">
                                    <td className="max-w-32 truncate p-2 text-muted-foreground">
                                      {c.deckPath}
                                    </td>
                                    <td className="max-w-64 truncate p-2">{c.pergunta}</td>
                                    <td className="max-w-64 truncate p-2 text-muted-foreground">
                                      {c.resposta}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {csvPreview.length > 5 && (
                              <p className="p-2 text-xs text-muted-foreground">
                                ...e mais {csvPreview.length - 5} card(s)
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : cardType === "oclusao" ? (
                  <div className="grid gap-3">
                    {!occlusionImageUrl ? (
                      <div
                        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground outline-none"
                        onPaste={handlePaste}
                        tabIndex={0}
                      >
                        <p>Cole uma imagem (Ctrl+V) ou escolha um arquivo</p>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileChange}
                          className="text-xs"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            Clique e arraste na imagem para marcar uma área. {regions.length}{" "}
                            área(s) marcada(s).
                          </span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="flex items-center gap-1 text-muted-foreground underline hover:text-foreground"
                              onClick={() => setEditorOpen(true)}
                            >
                              <Maximize2 className="size-3.5" /> Maximizar
                            </button>
                            <button
                              type="button"
                              className="text-muted-foreground underline hover:text-foreground"
                              onClick={() => {
                                setOcclusionFile(null);
                                setOcclusionImageUrl(null);
                                setRegions([]);
                              }}
                            >
                              Trocar imagem
                            </button>
                          </div>
                        </div>
                        <div className="flex">
                          <div
                            ref={imageAreaRef}
                            className="relative inline-block cursor-crosshair select-none overflow-hidden rounded-lg border border-border"
                            onMouseDown={handleMouseDown}
                          >
                            <img
                              src={occlusionImageUrl}
                              alt=""
                              className="pointer-events-none block max-h-80 w-auto max-w-full"
                              draggable={false}
                            />
                            {regions.map((r) => (
                              <div
                                key={r.id}
                                className="absolute border-2 border-amber-600 bg-amber-400/60"
                                style={{
                                  left: `${r.x}%`,
                                  top: `${r.y}%`,
                                  width: `${r.width}%`,
                                  height: `${r.height}%`,
                                }}
                              />
                            ))}
                            {drawing && (
                              <div
                                className="absolute border-2 border-dashed border-amber-500 bg-amber-400/30"
                                style={{
                                  left: `${drawing.x}%`,
                                  top: `${drawing.y}%`,
                                  width: `${drawing.width}%`,
                                  height: `${drawing.height}%`,
                                }}
                              />
                            )}
                          </div>
                        </div>

                        {regions.length > 0 && (
                          <ul className="space-y-2">
                            {regions.map((r, i) => (
                              <li key={r.id} className="flex flex-wrap items-center gap-2">
                                <span className="w-16 shrink-0 text-xs text-muted-foreground">
                                  Área {i + 1}
                                </span>
                                <Input
                                  value={r.label}
                                  onChange={(e) =>
                                    setRegions((prev) =>
                                      prev.map((x) =>
                                        x.id === r.id ? { ...x, label: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  placeholder="Rótulo (opcional)"
                                  className="flex-1"
                                />
                                <button
                                  type="button"
                                  className="shrink-0 text-xs text-destructive underline hover:text-destructive/80"
                                  onClick={() =>
                                    setRegions((prev) => prev.filter((x) => x.id !== r.id))
                                  }
                                >
                                  Remover
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                ) : cardType === "cloze" ? (
                  <ClozeEditor
                    text={clozeText}
                    hidden={hiddenTokens}
                    onTextChange={(v) => {
                      setClozeText(v);
                      setHiddenTokens(new Set());
                    }}
                    onToggleToken={toggleClozeToken}
                  />
                ) : (
                  <div className="grid gap-3">
                    <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                      Pergunta
                      <Input
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        placeholder="Escreva a pergunta do card"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                      Resposta
                      <Input
                        value={answer}
                        onChange={(event) => setAnswer(event.target.value)}
                        placeholder="Escreva a resposta do card"
                      />
                    </label>
                  </div>
                )}

                {cardType === "oclusao" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handlePasteButtonClick()}
                  >
                    <ClipboardPaste className="size-4" />
                    Colar Imagem da Área de Transferência
                  </Button>
                )}

                <Button
                  type="submit"
                  disabled={
                    cardType === "ia"
                      ? generating ||
                        (aiProposals ? aiAccepted.size === 0 : aiSource.trim().length < 40)
                      : cardType === "importar"
                        ? importing || !csvPreview || csvPreview.length === 0
                        : cardType === "oclusao"
                          ? uploading || !occlusionFile || regions.length === 0
                          : cloze
                            ? create.isPending || !clozeText.trim() || !hasHiddenWord
                            : create.isPending || !question.trim() || !answer.trim()
                  }
                >
                  {(
                    cardType === "ia"
                      ? generating
                      : cardType === "importar"
                        ? importing
                        : cardType === "oclusao"
                          ? uploading
                          : create.isPending
                  ) ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : cardType === "ia" ? (
                    <Sparkles className="size-4" />
                  ) : cardType === "importar" ? (
                    <Upload className="size-4" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {cardType === "ia"
                    ? aiProposals
                      ? `Criar ${aiAccepted.size} card(s)`
                      : "Gerar cards"
                    : cardType === "importar"
                      ? `Importar ${csvPreview?.length ?? ""} card(s)`
                      : cardType === "oclusao"
                        ? `Criar ${regions.length || ""} card(s)`
                        : "Criar card"}
                </Button>
              </form>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
