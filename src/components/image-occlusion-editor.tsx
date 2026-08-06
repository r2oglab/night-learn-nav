import { useEffect, useRef, useState } from "react";
import { Check, Crop as CropIcon, Square, Type, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type RegionDraft = { id: string; x: number; y: number; width: number; height: number; label: string };

type Rect = { x: number; y: number; width: number; height: number };
type DragRect = { startX: number; startY: number; x: number; y: number; width: number; height: number };
type PendingText = { id: string; x: number; y: number; text: string };
type Tool = "select" | "crop" | "text";

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
  const [drag, setDrag] = useState<DragRect | null>(null);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [imageChanged, setImageChanged] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  function getPos(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (tool === "text") return;
    const { x, y } = getPos(e.clientX, e.clientY);
    setDrag({ startX: x, startY: y, x, y, width: 0, height: 0 });
  }

  // Same window-level drag tracking as the inline editor, so dragging past
  // the image edge clamps instead of cancelling the selection.
  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;
    function move(e: MouseEvent) {
      const { x, y } = getPos(e.clientX, e.clientY);
      setDrag((prev) => {
        if (!prev) return prev;
        const newX = Math.min(x, prev.startX);
        const newY = Math.min(y, prev.startY);
        return { ...prev, x: newX, y: newY, width: Math.abs(x - prev.startX), height: Math.abs(y - prev.startY) };
      });
    }
    function up() {
      setDrag((prev) => {
        if (prev && prev.width > 1 && prev.height > 1) {
          if (tool === "select") {
            setLocalRegions((r) => [
              ...r,
              { id: crypto.randomUUID(), x: prev.x, y: prev.y, width: prev.width, height: prev.height, label: "" },
            ]);
          } else if (tool === "crop") {
            setCropRect({ x: prev.x, y: prev.y, width: prev.width, height: prev.height });
          }
        }
        return null;
      });
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [isDragging, tool]);

  function handleContainerClick(e: React.MouseEvent) {
    if (tool !== "text") return;
    const { x, y } = getPos(e.clientX, e.clientY);
    const id = crypto.randomUUID();
    setTexts((t) => [...t, { id, x, y, text: "" }]);
    setEditingTextId(id);
  }

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
      ctx.fillStyle = "#facc15";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(2, canvas.width * 0.003);
      ctx.font = `${Math.round(canvas.width * 0.03)}px sans-serif`;
      ctx.textBaseline = "top";
      for (const t of texts) {
        if (!t.text.trim()) continue;
        const px = (t.x / 100) * canvas.width;
        const py = (t.y / 100) * canvas.height;
        ctx.strokeText(t.text, px, py);
        ctx.fillText(t.text, px, py);
      }
    }

    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    const file = new File([blob], "editada.png", { type: "image/png" });
    onApply({ file, regions: localRegions });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-3 overflow-y-auto rounded-lg bg-card p-6 shadow-lg">
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
            <Button type="button" size="sm" onClick={() => void applyCrop()}>
              <Check className="size-4" /> Aplicar corte
            </Button>
          )}
        </div>

        <div
          ref={containerRef}
          className="relative w-full select-none overflow-hidden rounded-lg border border-border"
          style={{ cursor: tool === "text" ? "text" : "crosshair" }}
          onMouseDown={handleMouseDown}
          onClick={handleContainerClick}
        >
          <img ref={imgRef} src={workingUrl} alt="" className="pointer-events-none block w-full" draggable={false} />

          {tool !== "crop" &&
            localRegions.map((r) => (
              <div
                key={r.id}
                className="absolute border-2 border-amber-600 bg-amber-400/60"
                style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` }}
              />
            ))}

          {texts.map((t) =>
            editingTextId === t.id ? (
              <input
                key={t.id}
                autoFocus
                className="absolute z-10 rounded bg-background px-1 text-sm outline outline-2 outline-primary"
                style={{ left: `${t.x}%`, top: `${t.y}%` }}
                value={t.text}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTexts((prev) => prev.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))}
                onBlur={() => setEditingTextId(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setEditingTextId(null);
                  }
                }}
              />
            ) : (
              <div
                key={t.id}
                className="absolute z-10 cursor-pointer select-none rounded bg-black/70 px-1 text-sm font-semibold text-amber-300"
                style={{ left: `${t.x}%`, top: `${t.y}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTextId(t.id);
                }}
              >
                {t.text || "…"}
              </div>
            ),
          )}

          {drag && (tool === "select" || tool === "crop") && (
            <div
              className={`absolute border-2 border-dashed ${
                tool === "crop" ? "border-sky-500 bg-sky-400/30" : "border-amber-500 bg-amber-400/30"
              }`}
              style={{ left: `${drag.x}%`, top: `${drag.y}%`, width: `${drag.width}%`, height: `${drag.height}%` }}
            />
          )}

          {tool === "crop" && cropRect && (
            <div
              className="absolute border-2 border-sky-500 bg-sky-400/30"
              style={{ left: `${cropRect.x}%`, top: `${cropRect.y}%`, width: `${cropRect.width}%`, height: `${cropRect.height}%` }}
            />
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
            {texts.length} texto(s) adicionado(s), clique num texto pra editar.{" "}
            <button type="button" className="text-destructive underline hover:text-destructive/80" onClick={() => setTexts([])}>
              Limpar todos
            </button>
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