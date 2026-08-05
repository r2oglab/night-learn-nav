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
import { listThemes } from "@/lib/themes.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/configuracoes")({
  component: Configuracoes,
});

function Configuracoes() {
  const { user, signOut } = useAuth();

  const qc = useQueryClient();
  const fetchSettings = useServerFn(getUserSettings);
  const fetchCards = useServerFn(listCards);
  const fetchThemes = useServerFn(listThemes);

  const { data: settings } = useQuery({ queryKey: ["user_settings"], queryFn: () => fetchSettings() });
  const { data: themes = [] } = useQuery({ queryKey: ["themes"], queryFn: () => fetchThemes() });

  const upsertFn = useServerFn(upsertUserSettings);
  const upsertMutation = useMutation({ mutationFn: (vars: any) => upsertFn({ data: vars }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["user_settings"] }); toast.success("Configurações salvas"); } });

  const exportCsv = async () => {
    try {
      const cards = await fetchCards();
      const userCards = cards.filter((c: any) => c.user_id === user?.id);
      const themeById = Object.fromEntries((themes || []).map((t: any) => [t.id, t]));

      const rows: Record<string, any>[] = userCards.map((c: any) => ({
        tema: themeById[c.theme_id]?.name ?? c.theme_id,
        pergunta: c.pergunta,
        resposta: c.resposta,
        due: c.due,
        stability: c.stability,
        difficulty: c.difficulty,
      }));

      const header = ["tema","pergunta","resposta","due","stability","difficulty"];
      const csv = [header.join(",")].concat(rows.map((r) => header.map((h) => JSON.stringify(r[h] ?? "")).join(","))).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meus_cards_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV gerado");
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
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

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-2xl">
              <section className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-sm font-medium">Conta</h2>
                <div className="mt-4 grid gap-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">{user?.email ?? "—"}</div>
                    <Button variant="destructive" onClick={() => signOut()}>
                      Sair
                    </Button>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-sm text-muted-foreground">Sequência atual</div>
                    <div className="text-lg font-semibold">{settings?.streak ?? 0} dias</div>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-sm text-muted-foreground">Meta diária (cards)</div>
                    <div className="flex gap-2 items-center">
                      <Input type="number" value={settings?.daily_goal ?? 20} onChange={(e) => upsertMutation.mutate({ daily_goal: Number(e.target.value) })} className="w-24" />
                      <div className="text-sm text-muted-foreground">(Atual: {settings?.daily_goal ?? 20})</div>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-sm text-muted-foreground">Retenção desejada: {(Math.round((settings?.desired_retention ?? 0.9) * 1000) / 10).toFixed(1)}%</div>
                    <Slider
                      min={0.7}
                      max={0.97}
                      step={0.01}
                      value={[settings?.desired_retention ?? 0.9]}
                      onValueChange={([v]) => upsertMutation.mutate({ desired_retention: Number(v) })}
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
