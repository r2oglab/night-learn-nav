import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Loader2 } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { createCard } from "@/lib/cards.functions";
import { createDeck } from "@/lib/decks.functions";

export const Route = createFileRoute("/_authenticated/criacao")({
  component: CriacaoPage,
});

type CardType = "simples" | "invertido" | "cloze";

function CriacaoPage() {
  const queryClient = useQueryClient();
  const addCard = useServerFn(createCard);
  const createNewDeck = useServerFn(createDeck);

  const [deckPath, setDeckPath] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [cardType, setCardType] = useState<CardType>("simples");
  const invert = cardType === "invertido";
  const cloze = cardType === "cloze";

  const create = useMutation({
    mutationFn: (vars: { deck_id: string; pergunta: string; resposta?: string; invert?: boolean; cloze?: boolean }) =>
      addCard({ data: vars }),
    onSuccess: () => {
      setDeckPath("");
      setQuestion("");
      setAnswer("");
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
      toast.success("Card adicionado");
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
            <h1 className="text-sm font-medium">Criação</h1>
          </header>

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-3xl">
              <form
                className="mb-6 grid gap-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const deck = deckPath.trim();
                  if (!deck) { toast.error("Informe o caminho do deck (ex: Deck::Subdeck)"); return; }
                  if (!question.trim() || (!cloze && !answer.trim())) return;

                  try {
                      const deckRow = await createNewDeck({ data: { path: deck } });
                    if (!deckRow?.id) throw new Error("Não foi possível resolver/usar o deck.");
                    create.mutate({ deck_id: deckRow.id, pergunta: question.trim(), resposta: answer.trim(), invert, cloze });
                  } catch (err: any) {
                    toast.error(err?.message ?? String(err));
                  }
                }}
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    Deck (use `::` para sub-decks)
                    <Input
                      value={deckPath}
                      onChange={(event) => setDeckPath(event.target.value)}
                      placeholder="Ex: Biologia::Genética"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    Pergunta
                    <Input
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="Escreva a pergunta do card"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                  Resposta
                  <Input
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="Escreva a resposta do card"
                  />
                </label>
                <RadioGroup
                  value={cardType}
                  onValueChange={(v) => setCardType(v as CardType)}
                  className="flex items-center gap-4"
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
                </RadioGroup>

                <Button
                  type="submit"
                  disabled={create.isPending || !question.trim() || (!cloze && !answer.trim())}
                >
                  {create.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Criar card
                </Button>
              </form>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}