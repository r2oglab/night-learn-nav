import { useEffect, useRef, useState } from "react";
import { Check, Crop as CropIcon, Square, Type, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type RegionDraft = { id: string; x: number; y: number; width: number; height: number; label: string };

type Rect = { x: number; y: number; width: number; height: number };
type PendingText = { id: string; x: number; y: number; text: string; fontSize: number };
type Tool = "select" | "crop" | "text";

// A single unified model for anything the user can drag on the canvas:
// drawing a brand-new box, moving an existing box/text, or resizing an
// existing box via its corner handle. Kept in a ref (not state) so the
// window-level mousemove handler always reads the live anchor without
// needing to be re-subscribed on every pixel of movement.
type Interaction =
  | { kind: "draw"; tool: "select" | "crop"; startX: number; startY: number }
  | { kind: "move-region"; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize-region"; id: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number }
  | { kind: "move-crop"; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize-crop"; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number }
  | { kind: "move-text"; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
  | { kind: "resize-text"; id: string; startClientY: number; origSize: number };

const MIN_SIZE = 1.5; // percent — smallest a box is allowed to shrink to
const DEFAULT_FONT_SIZE = 16; // px, on-screen

export function ImageOcclusionEditor({
  imageUrl,
  regions,
  onClose,
  onApply,
}: {
  imageUrl: string;
  regions: RegionDraft[];
  onClose: () => void;
  onApply: (result: { file: File | null; regions: RegionDraft[] }) => void;
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [workingUrl, setWorkingUrl] = useState(imageUrl);
  const [localRegions, setLocalRegions] = useState<RegionDraft[]>(regions);
  const [texts, setTexts] = useState<PendingText[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Rect | null>(null); // live box while drawing
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [imageChanged, setImageChanged] = useState(false);
  const [active, setActive] = useState(false); // true whenever an interaction is in progress

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  // Mirrors `drag` synchronously so the mouseup handler can read the final
  // rectangle without nesting a setState call inside setDrag's updater —
  // that nesting is what caused each draw to create two regions (React
  // invokes updater functions twice in development to catch exactly this).
  const dragRef = useRef<Rect | null>(null);
  // A click just used to dismiss an in-progress text edit shouldn't also
  // count as "place a new text" — this flag suppresses that one click.
  const suppressNextTextClickRef = useRef(false);

  function getPos(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }

  function beginInteraction(interaction: Interaction) {
    interactionRef.current = interaction;
    setActive(true);
  }

  // Single window-level listener pair for every kind of drag. Attaching on
  // window (not just the small editing surface) means dragging past the
  // image edge clamps at the border instead of losing the interaction.
  useEffect(() => {
    if (!active) return;

    function handleMove(e: MouseEvent) {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const { x, y } = getPos(e.clientX, e.clientY);

      if (interaction.kind === "draw") {
        const newX = Math.min(x, interaction.startX);
        const newY = Math.min(y, interaction.startY);
        const rect = { x: newX, y: newY, width: Math.abs(x - interaction.startX), height: Math.abs(y - interaction.startY) };
        dragRef.current = rect;
        setDrag(rect);
      } else if (interaction.kind === "move-region") {
        const dx = x - interaction.startX;
        const dy = y - interaction.startY;
        setLocalRegions((prev) =>
          prev.map((r) => {
            if (r.id !== interaction.id) return r;
            const newX = Math.max(0, Math.min(100 - r.width, interaction.origX + dx));
            const newY = Math.max(0, Math.min(100 - r.height, interaction.origY + dy));
            return { ...r, x: newX, y: newY };
          }),
        );
      } else if (interaction.kind === "resize-region") {
        const newW = Math.max(MIN_SIZE, Math.min(100 - interaction.origX, interaction.origW + (x - interaction.startX)));
        const newH = Math.max(MIN_SIZE, Math.min(100 - interaction.origY, interaction.origH + (y - interaction.startY)));
        setLocalRegions((prev) => prev.map((r) => (r.id === interaction.id ? { ...r, width: newW, height: newH } : r)));
      } else if (interaction.kind === "move-crop") {
        const dx = x - interaction.startX;
        const dy = y - interaction.startY;
        setCropRect((prev) => {
          if (!prev) return prev;
          const newX = Math.max(0, Math.min(100 - prev.width, interaction.origX + dx));
          const newY = Math.max(0, Math.min(100 - prev.height, interaction.origY + dy));
          return { ...prev, x: newX, y: newY };
        });
      } else if (interaction.kind === "resize-crop") {
        const newW = Math.max(MIN_SIZE, Math.min(100 - interaction.origX, interaction.origW + (x - interaction.startX)));
        const newH = Math.max(MIN_SIZE, Math.min(100 - interaction.origY, interaction.origH + (y - interaction.startY)));
        setCropRect((prev) => (prev ? { ...prev, width: newW, height: newH } : prev));
      } else if (interaction.kind === "move-text") {
        const dx = x - interaction.startX;
        const dy = y - interaction.startY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) interaction.moved = true;
        const newX = Math.max(0, Math.min(100, interaction.origX + dx));
        const newY = Math.max(0, Math.min(100, interaction.origY + dy));
        setTexts((prev) => prev.map((t) => (t.id === interaction.id ? { ...t, x: newX, y: newY } : t)));
      } else if (interaction.kind === "resize-text") {
        const dy = e.clientY - interaction.startClientY;
        const newSize = Math.max(8, Math.min(72, interaction.origSize + dy));
        setTexts((prev) => prev.map((t) => (t.id === interaction.id ? { ...t, fontSize: newSize } : t)));
      }
    }

    function handleUp() {
      const interaction = interactionRef.current;
      interactionRef.current = null;
      setActive(false);

      if (interaction?.kind === "draw") {
        const finalRect = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (finalRect && finalRect.width > MIN_SIZE && finalRect.height > MIN_SIZE) {
          if (interaction.tool === "select") {
            setLocalRegions((r) => [
              ...r,
              { id: crypto.randomUUID(), x: finalRect.x, y: finalRect.y, width: finalRect.width, height: finalRect.height, label: "" },
            ]);
          } else {
            setCropRect({ x: finalRect.x, y: finalRect.y, width: finalRect.width, height: finalRect.height });
          }
        }
      } else if (interaction?.kind === "move-text" && !interaction.moved) {
        // A plain click (no real drag) on a text label enters edit mode.
        setEditingTextId(interaction.id);
        suppressNextTextClickRef.current = true;
      }
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [active]);

  function handleContainerMouseDown(e: React.MouseEvent) {
    if (tool === "text" || active) return;
    const { x, y } = getPos(e.clientX, e.clientY);
    const rect = { x, y, width: 0, height: 0 };
    dragRef.current = rect;
    setDrag(rect);
    beginInteraction({ kind: "draw", tool, startX: x, startY: y });
  }

  function handleContainerClick(e: React.MouseEvent) {
    if (tool !== "text") return;
    if (suppressNextTextClickRef.current) {
      suppressNextTextClickRef.current = false;
      return;
    }
    const { x, y } = getPos(e.clientX, e.clientY);
    const id = crypto.randomUUID();
    setTexts((t) => [...t, { id, x, y, text: "", fontSize: DEFAULT_FONT_SIZE }]);
    setEditingTextId(id);
  }

  function finishEditingText(id: string) {
    setTexts((prev) => {
      const t = prev.find((x) => x.id === id);
      if (t && t.text.trim() === "") return prev.filter((x) => x.id !== id);
      return prev;
    });
    setEditingTextId(null);
  }

  function startRegionMove(e: React.MouseEvent, region: RegionDraft) {
    e.stopPropagation();
    if (tool !== "select") return;
    const { x, y } = getPos(e.clientX, e.clientY);
    beginInteraction({ kind: "move-region", id: region.id, startX: x, startY: y, origX: region.x, origY: region.y });
  }

  function startRegionResize(e: React.MouseEvent, region: RegionDraft) {
    e.stopPropagation();
    const { x, y } = getPos(e.clientX, e.clientY);
    beginInteraction({ kind: "resize-region", id: region.id, startX: x, startY: y, origX: region.x, origY: region.y, origW: region.width, origH: region.height });
  }

  function startCropMove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!cropRect) return;
    const { x, y } = getPos(e.clientX, e.clientY);
    beginInteraction({ kind: "move-crop", startX: x, startY: y, origX: cropRect.x, origY: cropRect.y });
  }

  function startCropResize(e: React.MouseEvent) {
    e.stopPropagation();
    if (!cropRect) return;
    const { x, y } = getPos(e.clientX, e.clientY);
    beginInteraction({ kind: "resize-crop", startX: x, startY: y, origX: cropRect.x, origY: cropRect.y, origW: cropRect.width, origH: cropRect.height });
  }

  function startTextDrag(e: React.MouseEvent, t: PendingText) {
    e.stopPropagation();
    const { x, y } = getPos(e.clientX, e.clientY);
    beginInteraction({ kind: "move-text", id: t.id, startX: x, startY: y, origX: t.x, origY: t.y, moved: false });
  }

  function startTextResize(e: React.MouseEvent, t: PendingText) {
    e.stopPropagation();
    beginInteraction({ kind: "resize-text", id: t.id, startClientY: e.clientY, origSize: t.fontSize });
  }

  // Live preview of the crop result, redrawn whenever the crop rectangle
  // or working image changes.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !cropRect || tool !== "crop") return;
    const sx = (cropRect.x / 100) * img.naturalWidth;
    const sy = (cropRect.y / 100) * img.naturalHeight;
    const sw = (cropRect.width / 100) * img.naturalWidth;
    const sh = (cropRect.height / 100) * img.naturalHeight;
    if (sw <= 0 || sh <= 0) return;
    const maxDim = 150;
    const scale = Math.min(maxDim / sw, maxDim / sh);
    canvas.width = Math.max(1, sw * scale);
    canvas.height = Math.max(1, sh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }, [cropRect, tool, workingUrl]);

  async function applyCrop() {
    if (!cropRect || !imgRef.current) return;
    const img = imgRef.current;
    const sx = (cropRect.x / 100) * img.naturalWidth;
    const sy = (cropRect.y / 100) * img.naturalHeight;
    const sw = (cropRect.width / 100) * img.naturalWidth;
    const sh = (cropRect.height / 100) * img.naturalHeight;

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    setWorkingUrl(URL.createObjectURL(blob));
    setCropRect(null);
    setImageChanged(true);
    if (localRegions.length > 0 || texts.length > 0) {
      setLocalRegions([]);
      setTexts([]);
      toast.error("Áreas e textos foram reiniciados porque a imagem foi cortada.");
    }
  }

  async function handleSave() {
    if (texts.length === 0 && !imageChanged) {
      onApply({ file: null, regions: localRegions });
      return;
    }
    const img = imgRef.current!;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (texts.length > 0) {
      // Scale each text's on-screen font size up to the image's real
      // resolution, so it looks the same relative size once burned in as
      // it did while editing on screen.
      const displayWidth = img.getBoundingClientRect().width || img.naturalWidth;
      const scale = img.naturalWidth / displayWidth;
      ctx.fillStyle = "#facc15";
      ctx.strokeStyle = "#000000";
      ctx.textBaseline = "top";
      for (const t of texts) {
        if (!t.text.trim()) continue;
        const fontPx = Math.round(t.fontSize * scale);
        ctx.font = `${fontPx}px sans-serif`;
        ctx.lineWidth = Math.max(2, fontPx * 0.06);
        const px = (t.x / 100) * canvas.width;
        const py = (t.y / 100) * canvas.height;
        const maxWidth = canvas.width - px;
        ctx.strokeText(t.text, px, py, maxWidth);
        ctx.fillText(t.text, px, py, maxWidth);
      }
    }

    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    const file = new File([blob], "editada.png", { type: "image/png" });
    onApply({ file, regions: localRegions });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col gap-3 overflow-y-auto rounded-lg bg-card p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Editor de imagem</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={tool === "select" ? "default" : "outline"} onClick={() => setTool("select")}>
            <Square className="size-4" /> Marcar área
          </Button>
          <Button type="button" size="sm" variant={tool === "crop" ? "default" : "outline"} onClick={() => setTool("crop")}>
            <CropIcon className="size-4" /> Cortar
          </Button>
          <Button type="button" size="sm" variant={tool === "text" ? "default" : "outline"} onClick={() => setTool("text")}>
            <Type className="size-4" /> Texto
          </Button>
          {tool === "crop" && cropRect && (
            <>
              <Button type="button" size="sm" onClick={() => void applyCrop()}>
                <Check className="size-4" /> Aplicar corte
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCropRect(null)}>
                <X className="size-4" /> Remover seleção
              </Button>
            </>
          )}
          <span className="text-xs text-muted-foreground">
            {tool === "select" && "Arraste pra marcar. Arraste o centro de uma área pra mover, o canto pra redimensionar."}
            {tool === "crop" && "Arraste pra selecionar o corte. Arraste o centro pra mover, o canto pra redimensionar."}
            {tool === "text" && "Clique pra adicionar texto. Arraste o texto pra mover, o canto pra mudar o tamanho da fonte."}
          </span>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 justify-center">
            <div
              ref={containerRef}
              className="relative inline-block select-none overflow-hidden rounded-lg border border-border"
              style={{ cursor: tool === "text" ? "text" : "crosshair" }}
              onMouseDown={handleContainerMouseDown}
              onClick={handleContainerClick}
            >
              <img
                ref={imgRef}
                src={workingUrl}
                alt=""
                className="pointer-events-none block max-h-[70vh] w-auto max-w-full"
                draggable={false}
              />

              {tool !== "crop" &&
                localRegions.map((r) => (
                  <div
                    key={r.id}
                    className="absolute cursor-move border-2 border-amber-600 bg-amber-400/60"
                    style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` }}
                    onMouseDown={(e) => startRegionMove(e, r)}
                  >
                    <div
                      className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-full border border-white bg-amber-700"
                      onMouseDown={(e) => startRegionResize(e, r)}
                    />
                  </div>
                ))}

              {texts.map((t) =>
                editingTextId === t.id ? (
                  <textarea
                    key={t.id}
                    autoFocus
                    rows={1}
                    className="absolute z-10 resize-none whitespace-pre-wrap break-words rounded bg-background px-1 leading-tight outline outline-2 outline-primary"
                    style={{ left: `${t.x}%`, top: `${t.y}%`, maxWidth: `calc(100% - ${t.x}%)`, fontSize: `${t.fontSize}px` }}
                    value={t.text}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setTexts((prev) => prev.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))}
                    onBlur={() => finishEditingText(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        finishEditingText(t.id);
                      }
                    }}
                  />
                ) : (
                  <div
                    key={t.id}
                    className="absolute z-10 cursor-move select-none whitespace-pre-wrap break-words rounded bg-black/70 px-1 font-semibold leading-tight text-amber-300"
                    style={{ left: `${t.x}%`, top: `${t.y}%`, maxWidth: `calc(100% - ${t.x}%)`, fontSize: `${t.fontSize}px` }}
                    onMouseDown={(e) => startTextDrag(e, t)}
                  >
                    {t.text || "…"}
                    <div
                      className="absolute -bottom-1 -right-1 size-2.5 cursor-ns-resize rounded-full border border-white bg-amber-700"
                      onMouseDown={(e) => startTextResize(e, t)}
                    />
                  </div>
                ),
              )}

              {drag && (
                <div
                  className={`absolute border-2 border-dashed ${
                    tool === "crop" ? "border-sky-500 bg-sky-400/30" : "border-amber-500 bg-amber-400/30"
                  }`}
                  style={{ left: `${drag.x}%`, top: `${drag.y}%`, width: `${drag.width}%`, height: `${drag.height}%` }}
                />
              )}

              {tool === "crop" && cropRect && (
                <div
                  className="absolute cursor-move border-2 border-sky-500 bg-sky-400/30"
                  style={{ left: `${cropRect.x}%`, top: `${cropRect.y}%`, width: `${cropRect.width}%`, height: `${cropRect.height}%` }}
                  onMouseDown={startCropMove}
                >
                  <div
                    className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-full border border-white bg-sky-700"
                    onMouseDown={startCropResize}
                  />
                </div>
              )}
            </div>
          </div>

          {tool === "crop" && cropRect && (
            <div className="flex w-40 shrink-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">Prévia do corte</span>
              <canvas ref={previewCanvasRef} className="w-full rounded border border-border bg-background" />
            </div>
          )}
        </div>

        {tool === "select" && localRegions.length > 0 && (
          <ul className="space-y-2">
            {localRegions.map((r, i) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">Área {i + 1}</span>
                <Input
                  value={r.label}
                  onChange={(e) =>
                    setLocalRegions((prev) => prev.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)))
                  }
                  placeholder="Rótulo (opcional)"
                  className="flex-1"
                />
                <button
                  type="button"
                  className="shrink-0 text-xs text-destructive underline hover:text-destructive/80"
                  onClick={() => setLocalRegions((prev) => prev.filter((x) => x.id !== r.id))}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}

        {tool === "text" && texts.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {texts.length} texto(s). Clique pra editar, arraste o texto pra mover, arraste o cantinho pra mudar o tamanho —
            deixar vazio ao sair remove ele.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleSave()}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ImageOcclusionEditor;