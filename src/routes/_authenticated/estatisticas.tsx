import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { listDecks } from "@/lib/decks.functions";
import { getDeckRetention, getModuleComparison } from "@/lib/stats.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/estatisticas")({
  head: () => ({
    meta: [
      { title: "Estatísticas — Estuda" },
      {
        name: "description",
        content:
          "Retenção por módulo e evolução ao longo do tempo, a partir do histórico real de revisões.",
      },
    ],
  }),
  component: EstatisticasPage,
});

function formatWeekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function EstatisticasPage() {
  const fetchDecks = useServerFn(listDecks);
  const { data: decks = [] } = useQuery({ queryKey: ["decks"], queryFn: () => fetchDecks() });
  const rootDecks = decks.filter((d) => !d.parent_id);

  const fetchComparison = useServerFn(getModuleComparison);
  const { data: comparison = [], isLoading: comparisonLoading } = useQuery({
    queryKey: ["cards", "moduleComparison"],
    queryFn: () => fetchComparison(),
  });

  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const fetchRetention = useServerFn(getDeckRetention);
  const { data: retention = [], isLoading: retentionLoading } = useQuery({
    queryKey: ["cards", "retention", selectedDeckId],
    queryFn: () =>
      fetchRetention({
        data: { deck_id: selectedDeckId, tz_offset_minutes: new Date().getTimezoneOffset() },
      }),
  });

  const maxTotal = Math.max(1, ...comparison.map((m) => m.total));

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full overflow-x-hidden bg-background text-foreground">
        <AppSidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Estatísticas</h1>
          </header>

          <main className="flex min-w-0 flex-1 justify-center p-3 sm:p-6">
            <div className="w-full min-w-0 max-w-3xl space-y-4">
              <p className="text-xs text-muted-foreground">
                Baseado só em revisões reais (Estudo Livre não entra na conta).
              </p>

              <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <h2 className="mb-1 text-sm font-medium">Onde você está mais fraco</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  % de acerto por módulo, do mais fraco pro mais forte
                </p>
                {comparisonLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : comparison.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Ainda sem revisão real registrada — revise alguns cards (fora do Estudo Livre)
                    pra essa tela ganhar vida.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {comparison.map((mod) => (
                      <li key={mod.deckId}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="truncate font-medium">{mod.name}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {mod.pct}% · {mod.correct}/{mod.total}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              mod.pct < 70
                                ? "bg-destructive"
                                : mod.pct < 85
                                  ? "bg-pending"
                                  : "bg-primary",
                            )}
                            style={{ width: `${Math.max(4, mod.pct)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {maxTotal <= 3 && comparison.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Poucas revisões ainda — os números tendem a oscilar bastante até acumular mais
                    histórico.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium">Retenção ao longo do tempo</h2>
                  <select
                    value={selectedDeckId ?? ""}
                    onChange={(e) => setSelectedDeckId(e.target.value || null)}
                    className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs"
                  >
                    <option value="">Todos os módulos</option>
                    {rootDecks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                {retentionLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : retention.length < 2 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Precisa de pelo menos 2 semanas com revisão real pra desenhar uma curva.
                  </p>
                ) : (
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={retention} margin={{ left: -20, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                        <XAxis
                          dataKey="weekStart"
                          tickFormatter={formatWeekLabel}
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tickFormatter={(v) => `${v}%`}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip
                          formatter={(value: number, _name, item) => [
                            `${value}% (${item.payload.total} revisão/ões)`,
                            "Retenção",
                          ]}
                          labelFormatter={(label) => `Semana de ${formatWeekLabel(label)}`}
                        />
                        <Line
                          type="monotone"
                          dataKey="pct"
                          stroke="var(--color-primary)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}