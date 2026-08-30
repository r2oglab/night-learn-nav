import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Eye, Wand2, Check, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { explainCard, improveCard } from "@/lib/ai.functions";
import { Input } from "@/components/ui/input";
import { isClozeText, maskCloze, revealCloze } from "@/components/cloze-editor";

export type PreviewCard = {
  id?: string;
  pergunta: string;
  resposta: string;
  image_url?: string | null;
  occlusion_regions?: { id: string; x: number; y: number; width: number; height: number }[] | null;
  occlusion_target_id?: string | null;
  card_type?: string | null;
  image_placement?: string | null;
  explanation?: string | null;
};

/**
 * Shows a card the way it will actually appear during review, plus an
 * on-demand AI explanation.
 *
 * Until now the only way to see the rendered result was to start a review
 * session — which meant you couldn't check a card before committing to it,
 * and checking an existing one disturbed its scheduling.
 */
export function CardPreviewDialog({
  card,
  open,
  onOpenChange,
  onSave,
}: {
  card: PreviewCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the preview becomes editable and shows "Melhorar com IA". */
  onSave?: (updated: { pergunta: string; resposta: string }) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const explain = useServerFn(explainCard);
  const improve = useServerFn(improveCard);

  const [editing, setEditing] = useState(false);
  const [draftFront, setDraftFront] = useState("");
  const [draftBack, setDraftBack] = useState("");
  const [improving, setImproving] = useState(false);
  // Keeps the pre-AI version so a suggestion can be rejected without loss.
  const [beforeImprove, setBeforeImprove] = useState<{ p: string; r: string } | null>(null);
  const [noChangeNotice, setNoChangeNotice] = useState(false);

  // A new card means a fresh preview: nothing revealed, no stale explanation.
  useEffect(() => {
    setRevealed(false);
    setExplanation(card?.explanation ?? null);
    setEditing(false);
    setBeforeImprove(null);
    setNoChangeNotice(false);
    setDraftFront(card?.pergunta ?? "");
    setDraftBack(card?.resposta ?? "");
  }, [card?.pergunta, card?.resposta, card?.explanation, open]);

  async function handleExplain() {
    if (!card || explaining) return;
    setExplaining(true);
    try {
      const previous = explanation ? { previous_explanation: explanation } : {};
      const result = await explain({
        data: card.id
          ? { card_id: card.id, pergunta: card.pergunta, resposta: card.resposta, ...previous }
          : { pergunta: card.pergunta, resposta: card.resposta, ...previous },
      });
      setExplanation(result.explanation);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExplaining(false);
    }
  }

  async function handleImprove() {
    if (!card || improving) return;
    setImproving(true);
    try {
      const base = editing
        ? { pergunta: draftFront, resposta: draftBack }
        : { pergunta: card.pergunta, resposta: card.resposta };
      const result = await improve({ data: base });

      const unchanged = result.pergunta === base.pergunta && result.resposta === base.resposta;
      setNoChangeNotice(unchanged);
      if (unchanged) {
        // Nothing to undo, and forcing edit mode over an identical draft
        // would look exactly like the "did nothing" symptom we're avoiding.
        setBeforeImprove(null);
      } else {
        setBeforeImprove({ p: base.pergunta, r: base.resposta });
        setDraftFront(result.pergunta);
        setDraftBack(result.resposta);
        setEditing(true);
        setRevealed(true);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setImproving(false);
    }
  }

  if (!card) return null;

  const cloze = isClozeText(card.pergunta);
  const front = cloze ? maskCloze(card.pergunta) : card.pergunta;
  const back = cloze ? revealCloze(card.pergunta) : card.resposta;
  const imagePlacement = card.image_placement ?? "frente";
  const showImageOnFront = imagePlacement === "frente" || imagePlacement === "ambos";
  const showImageOnBack = imagePlacement === "verso" || imagePlacement === "ambos";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="size-4" /> Prévia do card
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-lg border border-border p-4">
            {card.image_url && card.occlusion_target_id ? (
              <div className="relative w-full overflow-hidden rounded-lg">
                <img src={card.image_url} alt="" className="block w-full" />
                {(card.occlusion_regions ?? []).map((region) => {
                  const isTarget = region.id === card.occlusion_target_id;
                  if (revealed && isTarget) return null;
                  return (
                    <div
                      key={region.id}
                      className={`absolute border-2 ${
                        isTarget ? "border-sky-600 bg-sky-500" : "border-amber-600 bg-amber-400"
                      }`}
                      style={{
                        left: `${region.x}%`,
                        top: `${region.y}%`,
                        width: `${region.width}%`,
                        height: `${region.height}%`,
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <>
                <div className="mb-2 text-xs text-muted-foreground">Frente</div>
                {editing ? (
                  <Input value={draftFront} onChange={(e) => setDraftFront(e.target.value)} />
                ) : (
                  <div className="whitespace-pre-wrap break-words text-base">{front}</div>
                )}
                {card.image_url && showImageOnFront && (
                  <img
                    src={card.image_url}
                    alt=""
                    className="mx-auto mt-3 block max-h-64 w-auto rounded-lg"
                  />
                )}
              </>
            )}

            {revealed && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 text-xs text-muted-foreground">Verso</div>
                {editing ? (
                  <Input value={draftBack} onChange={(e) => setDraftBack(e.target.value)} />
                ) : (
                  <div className="whitespace-pre-wrap break-words text-base">{back}</div>
                )}
                {card.image_url && showImageOnBack && (
                  <img
                    src={card.image_url}
                    alt=""
                    className="mx-auto mt-3 block max-h-64 w-auto rounded-lg"
                  />
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setRevealed((v) => !v)}>
              {revealed ? "Ocultar resposta" : "Revelar resposta"}
            </Button>
            {!explanation && (
              <Button
                variant="outline"
                size="sm"
                disabled={explaining}
                onClick={() => void handleExplain()}
              >
                <Sparkles className="size-3.5" />
                <span className="ml-1.5">{explaining ? "Explicando..." : "Explicar assunto"}</span>
              </Button>
            )}

            {onSave && !editing && !card.occlusion_target_id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraftFront(card.pergunta);
                  setDraftBack(card.resposta);
                  setEditing(true);
                  setRevealed(true);
                }}
              >
                Editar
              </Button>
            )}

            {onSave && !card.occlusion_target_id && (
              <Button
                variant="outline"
                size="sm"
                disabled={improving}
                onClick={() => void handleImprove()}
              >
                <Wand2 className="size-3.5" />
                <span className="ml-1.5">{improving ? "Melhorando..." : "Melhorar com IA"}</span>
              </Button>
            )}
          </div>

          {noChangeNotice && (
            <p className="text-xs text-muted-foreground">
              A IA avaliou o card e considerou que ele já está bom — nada foi alterado.
            </p>
          )}

          {beforeImprove && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <span className="text-muted-foreground">Sugestão da IA aplicada ao rascunho.</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftFront(beforeImprove.p);
                  setDraftBack(beforeImprove.r);
                  setBeforeImprove(null);
                }}
              >
                <Undo2 className="size-3.5" />
                <span className="ml-1">Desfazer sugestão</span>
              </Button>
            </div>
          )}

          {editing && onSave && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!draftFront.trim() || !draftBack.trim()}
                onClick={() => {
                  onSave({ pergunta: draftFront.trim(), resposta: draftBack.trim() });
                  setEditing(false);
                  setBeforeImprove(null);
                }}
              >
                <Check className="size-3.5" />
                <span className="ml-1">Salvar alterações</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setBeforeImprove(null);
                  setDraftFront(card.pergunta);
                  setDraftBack(card.resposta);
                }}
              >
                Cancelar
              </Button>
            </div>
          )}

          {explanation && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5" /> Explicação
                </div>
                <button
                  type="button"
                  disabled={explaining}
                  onClick={() => void handleExplain()}
                  className="shrink-0 text-xs text-sky-400 underline underline-offset-2 hover:text-sky-300 disabled:opacity-50"
                >
                  {explaining ? "Gerando..." : "Explicar de outro jeito"}
                </button>
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">{explanation}</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CardPreviewDialog;