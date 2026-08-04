import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Estuda — Calendário de revisões" },
      {
        name: "description",
        content:
          "Calendário mensal de revisões com etiquetas por tema: concluídas, atrasadas e pendentes.",
      },
      { property: "og:title", content: "Estuda — Calendário de revisões" },
      {
        property: "og:description",
        content:
          "Calendário mensal de revisões com etiquetas por tema: concluídas, atrasadas e pendentes.",
      },
    ],
  }),
  component: Index,
});

type Status = "done" | "overdue" | "pending";
type Review = { theme: string; status: Status };

const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];


const statusStyles: Record<Status, string> = {
  done: "bg-success/20 text-success border-success/30",
  overdue: "bg-overdue/20 text-overdue border-overdue/30",
  pending: "bg-pending/25 text-pending-foreground border-pending/40",
};

const legend: { label: string; status: Status }[] = [
  { label: "Concluída", status: "done" },
  { label: "Atrasada", status: "overdue" },
  { label: "Pendente", status: "pending" },
];

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth();
const monthLabel = now.toLocaleString("pt-BR", { month: "long", year: "numeric" });
const daysInMonth = new Date(year, month + 1, 0).getDate();
const firstWeekday = new Date(year, month, 1).getDay();
const today = now.getDate();

function Index() {
  const { data: reviewsByDay = {}, isLoading } = useQuery({
    queryKey: ["cards", year, month],
    queryFn: async () => {
      const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const end = `${year}-${String(month + 1).padStart(2, "0")}-${daysInMonth}`;
      const { data, error } = await supabase
        .from("cards")
        .select("id, theme_id, pergunta, resposta, due, state, last_review, themes(name)")
        .gte("due", start)
        .lte("due", end)
        .order("due", { ascending: true });
      if (error) throw error;

      function isSameDay(a: Date, b: Date) {
        return (
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate()
        );
      }

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const grouped: Record<number, Review[]> = {};
      for (const row of data ?? []) {
        const day = Number(row.due.slice(8, 10));
        const dueDate = new Date(`${row.due}T00:00:00`);
        const lastReview = row.last_review ? new Date(row.last_review) : null;

        const status: Status = lastReview && isSameDay(lastReview, todayStart)
          ? "done"
          : dueDate < todayStart
            ? "overdue"
            : "pending";

        (grouped[day] ??= []).push({
          theme: row.themes?.name ?? row.pergunta,
          status,
        });
      }
      return grouped;
    },
  });

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);


  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />

        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Dashboard</h1>
            <div className="ml-auto flex items-center gap-4">
              {legend.map((item) => (
                <div key={item.label} className="hidden items-center gap-2 sm:flex">
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      item.status === "done" && "bg-success",
                      item.status === "overdue" && "bg-overdue",
                      item.status === "pending" && "bg-pending",
                    )}
                  />
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </header>

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-[1400px] basis-4/5 md:w-4/5">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-xl font-semibold tracking-tight">{monthLabel}</h2>
                {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="icon" className="size-8">
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    Hoje
                  </Button>
                  <Button variant="outline" size="icon" className="size-8">
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="grid grid-cols-7 border-b border-border">
                  {weekDays.map((d) => (
                    <div
                      key={d}
                      className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7">
                  {cells.map((day, i) => (
                    <div
                      key={i}
                      className={cn(
                        "min-h-[120px] border-b border-r border-border p-1.5 last:border-r-0",
                        (i + 1) % 7 === 0 && "border-r-0",
                        day === null && "bg-muted/20",
                      )}
                    >
                      {day !== null && (
                        <>
                          <div className="mb-1 flex justify-end">
                            <span
                              className={cn(
                                "flex size-6 items-center justify-center rounded-full text-xs",
                                day === today
                                  ? "bg-primary font-semibold text-primary-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {day}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {(reviewsByDay[day] ?? []).map((review: Review, idx: number) => (
                              <div
                                key={idx}
                                className={cn(
                                  "truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                                  statusStyles[review.status],
                                )}
                              >
                                {review.theme}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
