import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Loader2, ClipboardPaste, Maximize2, Upload, Sparkles, Eye } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { createCard, createImageOcclusionCards, importCards } from "@/lib/cards.functions";
import { createDeck } from "@/lib/decks.functions";
import { generateCardsFromText, suggestMissingCards, transcribeFile } from "@/lib/ai.functions";
import { extractTextFromFile } from "@/lib/file-text-extract";
import { Textarea } from "@/components/ui/textarea";
import { CardPreviewDialog, type PreviewCard } from "@/components/card-preview-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageOcclusionEditor, type RegionDraft } from "@/components/image-occlusion-editor";
import { ClozeEditor, buildClozeText } from "@/components/cloze-editor";
import { TagInput } from "@/components/tag-input";
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
  const [tags, setTags] = useState<string[]>([]);
  const [cardType, setCardType] = useState<CardType>("simples");
  const invert = cardType === "invertido";
  const cloze = cardType === "cloze";
  const [attachedImageFile, setAttachedImageFile] = useState<File | null>(null);
  const [attachedImageUrl, setAttachedImageUrl] = useState<string | null>(null);
  const [attachedImagePlacement, setAttachedImagePlacement] = useState<
    "frente" | "verso" | "ambos"
  >("frente");

  function loadAttachedImage(file: File) {
    setAttachedImageFile(file);
    setAttachedImageUrl(URL.createObjectURL(file));
  }

  function handleAttachedImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadAttachedImage(file);
  }

  function handleAttachedImagePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (file) {
      e.preventDefault();
      loadAttachedImage(file);
    }
  }

  async function handleAttachedImagePasteButton() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], `colado.${imageType.split("/")[1] || "png"}`, {
            type: imageType,
          });
          loadAttachedImage(file);
          return;
        }
      }
      toast.error("Nenhuma imagem encontrada na área de transferência.");
    } catch {
      toast.error("Não foi possível acessar a área de transferência. Tente Ctrl+V na área acima.");
    }
  }
  const typeIn = cardType === "digitar";
  const [clozeText, setClozeText] = useState("");
  const [hiddenTokens, setHiddenTokens] = useState<Set<number>>(new Set());
  const hasHiddenWord = hiddenTokens.size > 0;
  const [oneCardPerGap, setOneCardPerGap] = useState(false);

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
  const [csvAutoTag, setCsvAutoTag] = useState("");
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

  const runSuggestMissing = useServerFn(suggestMissingCards);
  const runTranscribeFile = useServerFn(transcribeFile);
  const [suggestMissingMode, setSuggestMissingMode] = useState(false);
  const [extractingFile, setExtractingFile] = useState(false);

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
      reader.readAsDataURL(file);
    });
  }

  async function handleAiFileUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isVisionFile = ["pdf", "png", "jpg", "jpeg", "webp"].includes(ext);

    setExtractingFile(true);
    try {
      if (isVisionFile) {
        const fileBase64 = await fileToBase64(file);
        const result = await runTranscribeFile({
          data: { file_base64: fileBase64, file_name: file.name },
        });
        setAiSource(result.text);
        if (result.truncated) {
          toast.warning(
            `"${file.name}" é grande demais — a transcrição foi cortada no meio. Falta conteúdo do fim do arquivo; considere dividir em partes menores.`,
          );
        } else {
          toast.success(`"${file.name}" transcrito. Confira o texto antes de gerar os cards.`);
        }
        return;
      }

      const { text, truncated } = await extractTextFromFile(file);
      setAiSource(text);
      toast.success(
        truncated
          ? `Texto de "${file.name}" carregado (cortado — arquivo muito longo).`
          : `Texto de "${file.name}" carregado.`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExtractingFile(false);
    }
  }

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

  /** Same review flow as handleGenerate, but the suggestions come from
   * comparing the pasted text against this deck's existing cards instead
   * of generating fresh cards blind. */
  async function handleSuggestMissing(deck: string) {
    if (!deck) {
      toast.error("Informe o deck pra comparar com os cards existentes.");
      return;
    }
    setGenerating(true);
    try {
      const deckRow = await createNewDeck({ data: { path: deck } });
      if (!deckRow?.id) throw new Error("Não foi possível resolver/usar o deck.");
      const result = await runSuggestMissing({
        data: { deck_id: deckRow.id, text: aiSource },
      });
      const cards = result.suggestions.map((s) => ({ pergunta: s.pergunta, resposta: s.resposta }));
      setAiProposals(cards);
      setAiAccepted(new Set(cards.map((_, i) => i)));
      if (cards.length === 0) {
        toast.success("Nada faltando — o material já parece bem coberto pelos cards existentes.");
      }
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
        data: {
          cards: chosen.map((c) => ({ ...c, deckPath: deck })),
          tz_offset_minutes: new Date().getTimezoneOffset(),
        },
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
      image_url?: string | undefined;
      image_placement?: "frente" | "verso" | "ambos";
      tags?: string[];
      tz_offset_minutes: number;
    }) => addCard({ data: vars }),
    onSuccess: () => {
      setQuestion("");
      setAnswer("");
      setTags([]);
      setClozeText("");
      setHiddenTokens(new Set());
      setAttachedImageFile(null);
      setAttachedImageUrl(null);
      setAttachedImagePlacement("frente");
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
  // Mirrors `drawing` state but reads synchronously, with no dependency on
  // React's setState-updater timing — the commit logic in handlePointerUp
  // reads the finished rect from here, not from inside another setter's
  // callback (that nested-setter-in-updater pattern was the previous
  // suspect for the duplicate-region bug).
  const drawRectRef = useRef<DrawingRect | null>(null);

  // Pointer capture routes every subsequent move/up for this exact pointer
  // straight to this element — no window-level listener, no effect
  // lifecycle to accidentally double-register. anchorRef is nulled out
  // first thing in handlePointerUp, so even a stray extra pointerup finds
  // nothing left to commit.
  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const { x, y } = getRelativePos(e.clientX, e.clientY);
    drawAnchorRef.current = { startX: x, startY: y };
    const initial: DrawingRect = { startX: x, startY: y, x, y, width: 0, height: 0 };
    drawRectRef.current = initial;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(initial);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const anchor = drawAnchorRef.current;
    if (!anchor) return;
    const { x, y } = getRelativePos(e.clientX, e.clientY);
    const newX = Math.min(x, anchor.startX);
    const newY = Math.min(y, anchor.startY);
    const width = Math.abs(x - anchor.startX);
    const height = Math.abs(y - anchor.startY);
    const next: DrawingRect = {
      startX: anchor.startX,
      startY: anchor.startY,
      x: newX,
      y: newY,
      width,
      height,
    };
    drawRectRef.current = next;
    setDrawing(next);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const anchor = drawAnchorRef.current;
    drawAnchorRef.current = null;
    if (!anchor) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const finished = drawRectRef.current;
    drawRectRef.current = null;
    setDrawing(null);
    if (finished && finished.width > 1 && finished.height > 1) {
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
  }

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
    setCsvAutoTag(file.name.replace(/\.(csv|txt)$/i, "").trim());
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
      const result = await runImport({
        data: {
          cards: csvPreview,
          tz_offset_minutes: new Date().getTimezoneOffset(),
          tags: csvAutoTag.trim() ? [csvAutoTag.trim()] : [],
        },
      });
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      toast.success(`${result.imported} card(s) importado(s) em ${result.decks} deck(s)`);
      setCsvPreview(null);
      setCsvRawRows(null);
      setCsvFileName("");
      setCsvSkipped(0);
      setCsvTagsColumn(null);
      setCsvUseTagsAsDeck(false);
      setCsvAutoTag("");
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
          tz_offset_minutes: new Date().getTimezoneOffset(),
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
      <div className="flex min-h-screen w-full overflow-x-hidden bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Criação</h1>
          </header>

          <main className="flex min-w-0 flex-1 justify-center p-3 sm:p-6">
            <div className="w-full min-w-0 max-w-3xl">
              <CardPreviewDialog
                card={previewCard}
                open={previewCard !== null}
                onOpenChange={(o) => {
                  if (!o) setPreviewCard(null);
                }}
                onSave={(updated) => {
                  // Edits land on the proposal list, which is what gets created.
                  setAiProposals((prev) =>
                    (prev ?? []).map((c) =>
                      c.pergunta === previewCard?.pergunta && c.resposta === previewCard?.resposta
                        ? updated
                        : c,
                    ),
                  );
                  setPreviewCard((prev) => (prev ? { ...prev, ...updated } : prev));
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
                    // The "faltantes" mode is the exception — it needs the deck
                    // up front, to know which existing cards to compare against.
                    if (!aiProposals) {
                      if (suggestMissingMode) {
                        await handleSuggestMissing(deck);
                        return;
                      }
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

                    if (cloze && oneCardPerGap && hiddenTokens.size > 1) {
                      // Um card por lacuna: cada palavra marcada vira seu
                      // próprio card, escondida sozinha — não usa a
                      // mutation `create` porque o onSuccess dela reseta o
                      // formulário a cada chamada, e aqui isso precisa
                      // acontecer só uma vez, no final do lote.
                      const indices = Array.from(hiddenTokens);
                      for (const idx of indices) {
                        const singlePergunta = buildClozeText(clozeText, new Set([idx]));
                        await addCard({
                          data: {
                            deck_id: deckRow.id,
                            pergunta: singlePergunta,
                            resposta: singlePergunta,
                            invert: false,
                            cloze: true,
                            typeIn: false,
                            tags,
                            tz_offset_minutes: new Date().getTimezoneOffset(),
                          },
                        });
                      }
                      setClozeText("");
                      setHiddenTokens(new Set());
                      setTags([]);
                      void queryClient.invalidateQueries({ queryKey: ["cards"] });
                      void queryClient.invalidateQueries({ queryKey: ["decks"] });
                      toast.success(`${indices.length} cards criados (um por lacuna)`);
                      return;
                    }

                    const pergunta = cloze ? buildClozeQuestion() : question.trim();

                    let imageUrl: string | undefined;
                    if (attachedImageFile && !cloze) {
                      const ext = attachedImageFile.name.split(".").pop() || "png";
                      const path = `${crypto.randomUUID()}.${ext}`;
                      const { error: uploadError } = await supabase.storage
                        .from("card-images")
                        .upload(path, attachedImageFile);
                      if (uploadError) throw uploadError;
                      imageUrl = supabase.storage.from("card-images").getPublicUrl(path)
                        .data.publicUrl;
                    }

                    create.mutate({
                      deck_id: deckRow.id,
                      pergunta,
                      resposta: answer.trim(),
                      invert,
                      cloze,
                      typeIn,
                      image_url: imageUrl,
                      image_placement: attachedImagePlacement,
                      tags,
                      tz_offset_minutes: new Date().getTimezoneOffset(),
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
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={suggestMissingMode}
                            onChange={(e) => setSuggestMissingMode(e.target.checked)}
                          />
                          Só sugerir o que falta (compara com os cards que já existem no deck)
                        </label>
                        <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                          Conteúdo (aula, resumo, problema de PBL...)
                          <Textarea
                            value={aiSource}
                            onChange={(e) => setAiSource(e.target.value)}
                            placeholder="Cole aqui o texto que deve virar flashcards..."
                            className="min-h-40"
                          />
                          <span className="text-xs">
                            Ou{" "}
                            <label className="cursor-pointer text-sky-400 underline underline-offset-2 hover:text-sky-300">
                              {extractingFile
                                ? "lendo arquivo..."
                                : "envie um arquivo (.docx, .txt, .pdf, imagem)"}
                              <input
                                type="file"
                                accept=".docx,.txt,.md,.pdf,.png,.jpg,.jpeg,.webp"
                                className="hidden"
                                disabled={extractingFile}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = "";
                                  if (file) void handleAiFileUpload(file);
                                }}
                              />
                            </label>{" "}
                            — PDF e imagem (foto de slide, por exemplo) usam a IA pra ler o
                            conteúdo, inclusive texto dentro de figura; pode demorar mais que
                            .docx/.txt. O texto extraído substitui o que estiver colado aqui, pra
                            você conferir/editar antes de gerar.
                          </span>
                        </label>
                        {!suggestMissingMode && (
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
                        )}
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
                        <p>
                          <label className="cursor-pointer text-sky-400 underline underline-offset-2 hover:text-sky-300">
                            Escolha um arquivo
                            <input
                              type="file"
                              accept=".csv,.txt,text/csv,text/plain"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void handleCsvFile(file);
                              }}
                            />
                          </label>{" "}
                          .csv ou .txt exportado do Anki, Excel ou similar
                        </p>
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
                              setCsvAutoTag("");
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

                        <label className="flex flex-col gap-1.5 text-sm">
                          <span className="text-muted-foreground">
                            Tag automática (opcional) — marca todos os cards deste import
                          </span>
                          <Input
                            value={csvAutoTag}
                            onChange={(e) => setCsvAutoTag(e.target.value)}
                            placeholder="Sem tag"
                            className="max-w-xs"
                          />
                        </label>

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
                        <p>
                          Cole uma imagem (Ctrl+V) ou{" "}
                          <label className="cursor-pointer text-sky-400 underline underline-offset-2 hover:text-sky-300">
                            escolha um arquivo
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleFileChange}
                            />
                          </label>
                        </p>
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
                            className="relative inline-block touch-none select-none overflow-hidden rounded-lg border border-border cursor-crosshair"
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
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
                  <div className="grid gap-3">
                    <ClozeEditor
                      text={clozeText}
                      hidden={hiddenTokens}
                      onTextChange={(v) => {
                        setClozeText(v);
                        setHiddenTokens(new Set());
                      }}
                      onToggleToken={toggleClozeToken}
                    />
                    {hiddenTokens.size > 1 && (
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={oneCardPerGap}
                          onChange={(e) => setOneCardPerGap(e.target.checked)}
                        />
                        Criar {hiddenTokens.size} cards separados (um por lacuna) em vez de 1 com
                        todas escondidas juntas
                      </label>
                    )}
                    <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                      Tags (opcional)
                      <TagInput tags={tags} onChange={setTags} />
                    </label>
                  </div>
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

                    <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                      Tags (opcional)
                      <TagInput tags={tags} onChange={setTags} />
                    </label>

                    <div className="grid gap-2">
                      <span className="text-sm text-muted-foreground">Imagem (opcional)</span>
                      {attachedImageUrl ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <img
                            src={attachedImageUrl}
                            alt=""
                            className="max-h-32 w-auto rounded-lg border border-border"
                          />
                          <div className="grid gap-2">
                            <RadioGroup
                              value={attachedImagePlacement}
                              onValueChange={(v) => setAttachedImagePlacement(v as any)}
                              className="flex flex-wrap items-center gap-3"
                            >
                              <label className="flex items-center gap-1.5 text-sm">
                                <RadioGroupItem value="frente" />
                                <span className="text-muted-foreground">Na frente</span>
                              </label>
                              <label className="flex items-center gap-1.5 text-sm">
                                <RadioGroupItem value="verso" />
                                <span className="text-muted-foreground">No verso</span>
                              </label>
                              <label className="flex items-center gap-1.5 text-sm">
                                <RadioGroupItem value="ambos" />
                                <span className="text-muted-foreground">Nos dois</span>
                              </label>
                            </RadioGroup>
                            <button
                              type="button"
                              className="self-start text-xs text-destructive underline hover:text-destructive/80"
                              onClick={() => {
                                setAttachedImageFile(null);
                                setAttachedImageUrl(null);
                                setAttachedImagePlacement("frente");
                              }}
                            >
                              Remover imagem
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground outline-none"
                          onPaste={handleAttachedImagePaste}
                          tabIndex={0}
                        >
                          <p>
                            Cole uma imagem (Ctrl+V) ou{" "}
                            <label className="cursor-pointer text-sky-400 underline underline-offset-2 hover:text-sky-300">
                              escolha um arquivo
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleAttachedImageChange}
                              />
                            </label>
                          </p>
                          <button
                            type="button"
                            className="text-xs text-sky-400 underline underline-offset-2 hover:text-sky-300"
                            onClick={() => void handleAttachedImagePasteButton()}
                          >
                            colar da área de transferência
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Aparece junto da pergunta e/ou da resposta na revisão. Diferente de "Oclusão
                        de imagem" — aqui nada fica escondido na figura.
                      </p>
                    </div>
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
                        (aiProposals
                          ? aiAccepted.size === 0
                          : suggestMissingMode
                            ? !deckPath.trim() || aiSource.trim().length < 40
                            : aiSource.trim().length < 40)
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
                      : suggestMissingMode
                        ? "Analisar lacunas"
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