import { createFileRoute } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { getUserSettings, upsertUserSettings } from "@/lib/user_settings.functions";
import { listCards } from "@/lib/cards.functions";
import { listDecks } from "@/lib/decks.functions";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/configuracoes")({
  component: Configuracoes,
});

function Configuracoes() {
  const { user, signOut } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [dailyLimitInput, setDailyLimitInput] = useState("");

  const qc = useQueryClient();
  const fetchSettings = useServerFn(getUserSettings);
  const fetchCards = useServerFn(listCards);
  const fetchDecks = useServerFn(listDecks);

  const { data: settings } = useQuery({
    queryKey: ["user_settings"],
    queryFn: () => fetchSettings(),
  });
  const { data: decks = [] } = useQuery({ queryKey: ["decks"], queryFn: () => fetchDecks() });

  const upsertFn = useServerFn(upsertUserSettings);
  const upsertMutation = useMutation({
    mutationFn: (vars: any) => upsertFn({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["user_settings"] });
      toast.success("Configurações salvas");
    },
  });

  // Seed the input once settings arrive; typing afterwards is local state
  // so the field doesn't fight the user mid-edit.
  useEffect(() => {
    if (settings?.display_name) setDisplayName(settings.display_name);
  }, [settings?.display_name]);

  useEffect(() => {
    setDailyLimitInput(settings?.daily_limit != null ? String(settings.daily_limit) : "");
  }, [settings?.daily_limit]);

  async function handleAvatarUpload(file: File) {
    setUploadingAvatar(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user?.id ?? crypto.randomUUID()}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file);
      if (error) throw error;
      const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      upsertMutation.mutate({ avatar_url: url });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingAvatar(false);
    }
  }

  const exportCsv = async () => {
    try {
      const cards = await fetchCards();
      const userCards = cards.filter((c: any) => c.user_id === user?.id);
      const deckById = Object.fromEntries((decks || []).map((t: any) => [t.id, t]));
      const rows = userCards.map((c: any) => ({
        deck: deckById[c.deck_id]?.name ?? c.deck_id,
        pergunta: c.pergunta,
        resposta: c.resposta,
        due: c.due,
        stability: c.stability,
        difficulty: c.difficulty,
      }));

      const header = ["deck", "pergunta", "resposta", "due", "stability", "difficulty"] as const;
      const csv = [header.join(",")]
        .concat(rows.map((r) => header.map((h) => JSON.stringify(r[h] ?? "")).join(",")))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meus_cards_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV gerado");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Configurações</h1>
          </header>

          <main className="flex flex-1 justify-center p-3 sm:p-6">
            <div className="w-full max-w-2xl">
              <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
                <h2 className="text-sm font-medium">Conta</h2>
                <div className="mt-4 grid gap-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">{user?.email ?? "—"}</div>
                    <Button variant="destructive" onClick={() => signOut()}>
                      Sair
                    </Button>
                  </div>

                  <div className="grid gap-3 border-t border-border pt-4">
                    <div className="text-sm text-muted-foreground">Perfil</div>
                    <div className="flex flex-wrap items-center gap-4">
                      {settings?.avatar_url ? (
                        <img
                          src={settings.avatar_url}
                          alt=""
                          className="size-16 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
                          {(settings?.display_name || user?.email || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <input
                          type="file"
                          accept="image/*"
                          className="text-xs"
                          disabled={uploadingAvatar}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleAvatarUpload(file);
                          }}
                        />
                        {settings?.avatar_url && (
                          <button
                            type="button"
                            className="self-start text-xs text-destructive underline hover:text-destructive/80"
                            onClick={() => upsertMutation.mutate({ avatar_url: "" })}
                          >
                            Remover foto
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
                        Nome de exibição
                        <Input
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder={user?.email ?? "Seu nome"}
                        />
                      </label>
                      <Button
                        onClick={() => upsertMutation.mutate({ display_name: displayName })}
                        disabled={upsertMutation.isPending}
                      >
                        Salvar nome
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 border-t border-border pt-4">
                    <div className="text-sm text-muted-foreground">Sequência atual</div>
                    <div className="text-lg font-semibold">{settings?.streak ?? 0} dias</div>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-sm text-muted-foreground">Meta diária (cards)</div>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number"
                        value={settings?.daily_goal ?? 20}
                        onChange={(e) =>
                          upsertMutation.mutate({ daily_goal: Number(e.target.value) })
                        }
                        className="w-24"
                      />
                      <div className="text-sm text-muted-foreground">
                        (Atual: {settings?.daily_goal ?? 20})
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Alvo usado para colorir o mapa de calor. Não impede revisões.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-sm text-muted-foreground">Limite diário (cards)</div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={dailyLimitInput}
                        onChange={(e) => setDailyLimitInput(e.target.value)}
                        placeholder="Sem limite"
                        className="w-32"
                      />
                      <Button
                        onClick={() =>
                          upsertMutation.mutate({
                            daily_limit:
                              dailyLimitInput.trim() === "" ? null : Number(dailyLimitInput),
                          })
                        }
                        disabled={upsertMutation.isPending}
                      >
                        Salvar limite
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Teto de revisões do dia somando todos os decks. Deixe vazio para não limitar.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-sm text-muted-foreground">
                      Retenção desejada:{" "}
                      {(Math.round((settings?.desired_retention ?? 0.9) * 1000) / 10).toFixed(1)}%
                    </div>
                    <Slider
                      min={0.7}
                      max={0.97}
                      step={0.01}
                      value={[settings?.desired_retention ?? 0.9]}
                      onValueChange={([v]) =>
                        upsertMutation.mutate({ desired_retention: Number(v) })
                      }
                    />
                  </div>

                  <div className="grid gap-2">
                    <Button onClick={() => void exportCsv()}>Exportar meus dados (CSV)</Button>
                  </div>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
