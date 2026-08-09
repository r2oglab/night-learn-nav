import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Loader2, ClipboardPaste, Maximize2 } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { createCard, createImageOcclusionCards } from "@/lib/cards.functions";
import { createDeck } from "@/lib/decks.functions";
import { ImageOcclusionEditor, type RegionDraft } from "@/components/image-occlusion-editor";

export const Route = createFileRoute("/_authenticated/criacao")({
  component: CriacaoPage,
});

type CardType = "simples" | "invertido" | "cloze" | "oclusao";

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
  const [clozeText, setClozeText] = useState("");
  const [hiddenTokens, setHiddenTokens] = useState<Set<number>>(new Set());
  const clozeTokens = clozeText.split(/(\s+)/);
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
    return clozeTokens.map((tok, i) => (hiddenTokens.has(i) ? `{{c::${tok}}}` : tok)).join("");
  }

  // Image occlusion state
  const [occlusionFile, setOcclusionFile] = useState<File | null>(null);
  const [occlusionImageUrl, setOcclusionImageUrl] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionDraft[]>([]);
  const [drawing, setDrawing] = useState<DrawingRect | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const imageAreaRef = useRef<HTMLDivElement>(null);

  const create = useMutation({
    mutationFn: (vars: {
      deck_id: string;
      pergunta: string;
      resposta?: string;
      invert?: boolean;
      cloze?: boolean;
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
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
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

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-3xl">
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
                  const deck = deckPath.trim();
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
                    });
                  } catch (err: any) {
                    toast.error(err?.message ?? String(err));
                  }
                }}
              >
                <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                  Deck (use `::` para sub-decks)
                  <Input
                    value={deckPath}
                    onChange={(event) => setDeckPath(event.target.value)}
                    placeholder="Ex: Biologia::Genética"
                  />
                </label>

                <RadioGroup
                  value={cardType}
                  onValueChange={(v) => setCardType(v as CardType)}
                  className="flex flex-wrap items-center gap-4"
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
                    <RadioGroupItem value="oclusao" />
                    <span className="text-muted-foreground">Oclusão de imagem</span>
                  </label>
                </RadioGroup>

                {cardType === "oclusao" ? (
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
                              <li key={r.id} className="flex items-center gap-2">
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
                  <div className="grid gap-2">
                    <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                      Frase
                      <Input
                        value={clozeText}
                        onChange={(event) => {
                          setClozeText(event.target.value);
                          setHiddenTokens(new Set());
                        }}
                        placeholder="Ex: A capital da França é Paris"
                      />
                    </label>

                    {clozeText.trim() !== "" && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Clique nas palavras que quer esconder:
                        </p>
                        <p className="rounded-md border border-border p-3 text-sm leading-relaxed">
                          {clozeTokens.map((tok, i) =>
                            tok.trim() === "" ? (
                              <span key={i}>{tok}</span>
                            ) : (
                              <span
                                key={i}
                                onClick={() => toggleClozeToken(i)}
                                className={
                                  hiddenTokens.has(i)
                                    ? "cursor-pointer rounded bg-primary px-0.5 text-primary-foreground"
                                    : "cursor-pointer rounded px-0.5 hover:bg-muted"
                                }
                              >
                                {tok}
                              </span>
                            ),
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Pré-visualização:{" "}
                          <span className="text-foreground">
                            {hasHiddenWord
                              ? clozeTokens
                                  .map((tok, i) => (hiddenTokens.has(i) ? "___" : tok))
                                  .join("")
                              : "(nenhuma palavra marcada ainda)"}
                          </span>
                        </p>
                      </>
                    )}
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
                    cardType === "oclusao"
                      ? uploading || !occlusionFile || regions.length === 0
                      : cloze
                        ? create.isPending || !clozeText.trim() || !hasHiddenWord
                        : create.isPending || !question.trim() || !answer.trim()
                  }
                >
                  {(cardType === "oclusao" ? uploading : create.isPending) ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {cardType === "oclusao" ? `Criar ${regions.length || ""} card(s)` : "Criar card"}
                </Button>
              </form>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
