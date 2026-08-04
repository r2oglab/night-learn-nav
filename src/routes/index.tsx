import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Flame, Layers, TrendingUp } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Estuda — Painel de estudos e flashcards" },
      {
        name: "description",
        content:
          "Painel escuro para acompanhar revisões, flashcards e progresso de estudos em um só lugar.",
      },
      { property: "og:title", content: "Estuda — Painel de estudos e flashcards" },
      {
        property: "og:description",
        content:
          "Painel escuro para acompanhar revisões, flashcards e progresso de estudos em um só lugar.",
      },
    ],
  }),
  component: Index,
});

const stats = [
  { label: "Revisões hoje", value: "24", icon: CalendarClock },
  { label: "Flashcards ativos", value: "312", icon: Layers },
  { label: "Sequência", value: "7 dias", icon: Flame },
  { label: "Retenção", value: "86%", icon: TrendingUp },
];

function Index() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />

        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Dashboard</h1>
            <Button size="sm" className="ml-auto">
              Iniciar revisão
            </Button>
          </header>

          <main className="flex-1 space-y-6 p-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <Card key={stat.label} className="border-border bg-card">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {stat.label}
                    </CardTitle>
                    <stat.icon className="size-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tracking-tight">{stat.value}</p>
                  </CardContent>
                </Card>
              ))}
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <Card className="border-border bg-card lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Progresso semanal</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex h-48 items-end gap-3">
                    {[40, 65, 30, 80, 55, 90, 70].map((h, i) => (
                      <div key={i} className="flex flex-1 flex-col items-center gap-2">
                        <div
                          className="w-full rounded-t-md bg-primary/70"
                          style={{ height: `${h}%` }}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {["S", "T", "Q", "Q", "S", "S", "D"][i]}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-base">Próximas revisões</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {["Anatomia — Sistema ósseo", "Inglês — Phrasal verbs", "História — Idade Média"].map(
                    (item) => (
                      <div
                        key={item}
                        className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2"
                      >
                        <span className="text-sm">{item}</span>
                        <span className="text-xs text-muted-foreground">hoje</span>
                      </div>
                    ),
                  )}
                </CardContent>
              </Card>
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
