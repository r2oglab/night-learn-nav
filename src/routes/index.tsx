import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { capitalizeFirst, cn } from "@/lib/utils";
import { listDecks } from "@/lib/decks.functions";
import { getHeatmapData } from "@/lib/cards.functions";
import { getTodayFocus } from "@/lib/dashboard.functions";

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
type Review = { deck: string; statuses: Status[] };

const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const statusStyles: Record<Status, string> = {
  done: "bg-success/20 text-success border-success/30",
  overdue: "bg-overdue/20 text-overdue border-overdue/30",
  pending: "bg-pending/25 text-pending-foreground border-pending/40",
};

function Index() {
  // realNow must only ever be computed in the browser. Reading it at module
  // scope (or anywhere in the SSR render path) runs during the Cloudflare
  // Workers global/isolate scope, where real wall-clock time isn't
  // available and Date resolves to the Unix epoch — that's what produced
  // "janeiro de 1970" on the server while the client showed the real date,
  // a hydration mismatch. Start null and fill it in after mount.
  const [realNow, setRealNow] = useState<Date | null>(null);
  useEffect(() => {
    setRealNow(new Date());
  }, []);

  const [viewYear, setViewYear] = useState<number | null>(null);
  const [viewMonth, setViewMonth] = useState<number | null>(null);
  useEffect(() => {
    if (!realNow) return;
    setViewYear(realNow.getFullYear());
    setViewMonth(realNow.getMonth());
  }, [realNow]);

  const dateReady = realNow !== null && viewYear !== null && viewMonth !== null;

  const monthLabel = dateReady
    ? capitalizeFirst(
        new Date(viewYear!, viewMonth!, 1).toLocaleString("pt-BR", {
          month: "long",
          year: "numeric",
        }),
      )
    : "";
  const daysInMonth = dateReady ? new Date(viewYear!, viewMonth! + 1, 0).getDate() : 0;
  const firstWeekday = dateReady ? new Date(viewYear!, viewMonth!, 1).getDay() : 0;
  const isViewingCurrentMonth =
    dateReady && viewYear === realNow!.getFullYear() && viewMonth === realNow!.getMonth();
  const today = isViewingCurrentMonth ? realNow!.getDate() : null;

  const fetchDecks = useServerFn(listDecks);
  const { data: allDecks = [], isLoading: decksLoading } = useQuery({
    queryKey: ["decks"],
    queryFn: () => fetchDecks(),
  });

  const fetchTodayFocus = useServerFn(getTodayFocus);
  const { data: todayFocus } = useQuery({
    queryKey: ["todayFocus"],
    queryFn: () => fetchTodayFocus({ data: { tz_offset_minutes: new Date().getTimezoneOffset() } }),
  });

  const fetchHeatmapData = useServerFn(getHeatmapData);

  const [showOthersDay, setShowOthersDay] = useState<number | null>(null);

  const { data: reviewsByDay = {}, isLoading } = useQuery({
    queryKey: ["cards", viewYear, viewMonth, /* depends on decks */ allDecks.length],
    enabled: !decksLoading && dateReady,
    queryFn: async () => {
      const start = `${viewYear}-${String(viewMonth! + 1).padStart(2, "0")}-01`;
      const end = `${viewYear}-${String(viewMonth! + 1).padStart(2, "0")}-${daysInMonth}`;

      // Busca 1: por due (decide only between overdue and pending)
      const { data: dueData, error: dueError } = await supabase
        .from("cards")
        .select("id, deck_id, pergunta, resposta, due, state, last_review, decks(name)")
        .eq("suspended", false)
        .gte("due", start)
        .lte("due", end)
        .order("due", { ascending: true });
      if (dueError) throw dueError;

      // Busca 2: por last_review (done only on the exact review day)
      const { data: reviewData, error: reviewError } = await supabase
        .from("cards")
        .select("id, deck_id, pergunta, resposta, last_review, decks(name)")
        .not("last_review", "is", null)
        .gte("last_review", start)
        .lte("last_review", end)
        .order("last_review", { ascending: true });
      if (reviewError) throw reviewError;

      function dayFromISO(iso?: string) {
        if (!iso) return null;
        return Number(iso.slice(8, 10));
      }

      const todayStart = new Date(realNow!.getFullYear(), realNow!.getMonth(), realNow!.getDate());

      type DayEntry = { id: string; deck: string; statuses: Status[]; labelDate?: string };
      // Build deck map to resolve root decks
      const deckById = Object.fromEntries((allDecks ?? []).map((t: any) => [t.id, t]));

      function findRootName(deckId?: string, fallback?: string) {
        if (!deckId) return fallback ?? "(sem deck)";
        let cur = deckById[deckId];
        if (!cur) return fallback ?? "(sem deck)";
        while (cur && cur.parent_id) {
          cur = deckById[cur.parent_id];
        }
        return cur?.name ?? fallback ?? "(sem deck)";
      }

      type DayGroup = { deck: string; counts: Record<Status, number>; total: number };
      const grouped: Record<number, Map<string, DayGroup>> = {};

      // process dueData: decide only between overdue and pending
      for (const row of dueData ?? []) {
        const day = dayFromISO(row.due);
        if (!day) continue;
        const dueDate = new Date(`${row.due}T00:00:00`);

        const status: Status = dueDate < todayStart ? "overdue" : "pending";
        const rootName = findRootName(row.deck_id, row.decks?.name ?? row.pergunta);
        grouped[day] = grouped[day] ?? new Map();
        const m = grouped[day];
        const prev = m.get(rootName) ?? {
          deck: rootName,
          counts: { done: 0, overdue: 0, pending: 0 },
          total: 0,
        };
        prev.counts[status] = (prev.counts[status] ?? 0) + 1;
        prev.total += 1;
        m.set(rootName, prev);
      }

      // process reviewData: add 'done' status on the exact review day
      for (const row of reviewData ?? []) {
        const day = dayFromISO(row.last_review);
        if (!day) continue;
        const rootName = findRootName(row.deck_id, row.decks?.name ?? row.pergunta);
        grouped[day] = grouped[day] ?? new Map();
        const m = grouped[day];
        const prev = m.get(rootName) ?? {
          deck: rootName,
          counts: { done: 0, overdue: 0, pending: 0 },
          total: 0,
        };
        prev.counts["done"] = (prev.counts["done"] ?? 0) + 1;
        prev.total += 1;
        m.set(rootName, prev);
      }

      // convert DayEntry to Review[] (strip ids/labelDate)
      const result: Record<number, DayGroup[]> = {};
      for (const dayStr of Object.keys(grouped)) {
        const day = Number(dayStr);
        const arr = Array.from(grouped[day]?.values() ?? []);
        arr.sort((a, b) => b.total - a.total);
        result[day] = arr;
      }
      return result;
    },
  });

  // Heatmap: last 35 days up to today
  const heatStart = dateReady ? new Date(realNow!) : null;
  if (heatStart) heatStart.setDate(realNow!.getDate() - 34);
  const heatStartISO = heatStart
    ? `${heatStart.getFullYear()}-${String(heatStart.getMonth() + 1).padStart(2, "0")}-${String(heatStart.getDate()).padStart(2, "0")}`
    : "";
  const heatEndISO = dateReady
    ? `${realNow!.getFullYear()}-${String(realNow!.getMonth() + 1).padStart(2, "0")}-${String(realNow!.getDate()).padStart(2, "0")}`
    : "";

  const { data: heatmap = [], isLoading: heatLoading } = useQuery({
    queryKey: ["heatmap", heatStartISO, heatEndISO],
    enabled: !decksLoading && dateReady,
    retry: 2,
    queryFn: async () => {
      const { rows, dailyGoal } = await fetchHeatmapData({
        data: { start: heatStartISO, end: heatEndISO },
      });

      const dayMap: Record<string, number> = {};
      for (let i = 0; i < 35; i++) {
        const d = new Date(heatStart!);
        d.setDate(d.getDate() + i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        dayMap[key] = 0;
      }

      for (const row of rows ?? []) {
        const day = row.last_review?.slice(0, 10);
        if (!day) continue;
        if (dayMap[day] === undefined) continue;
        dayMap[day] += 1;
      }

      const arr: number[] = [];
      for (let i = 0; i < 35; i++) {
        const d = new Date(heatStart!);
        d.setDate(d.getDate() + i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const count = dayMap[key] ?? 0;
        const pct = dailyGoal > 0 ? Math.min(100, Math.round((count / dailyGoal) * 100)) : 0;
        arr.push(pct);
      }
      return arr;
    },
  });

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // Mini calendar heatmap: same weekday-alignment technique as the main calendar,
  // padded with leading nulls so the grid lines up as real weeks (7 columns).
  const heatFirstWeekday = heatStart ? heatStart.getDay() : 0;
  const heatCells: ({ pct: number } | null)[] = [
    ...Array.from({ length: heatFirstWeekday }, () => null),
    ...heatmap.map((pct: number) => ({ pct })),
  ];
  while (heatCells.length % 7 !== 0) heatCells.push(null);
  // Overdue count: cards strictly before today, regardless of which month is
  // being viewed — mirrors the same "atrasado" definition used em Revisões.
  const { data: overdueCount = 0 } = useQuery({
    queryKey: ["overdue-count", heatEndISO],
    enabled: dateReady,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("cards")
        .select("id", { count: "exact", head: true })
        // Suspended cards are deliberately parked; counting them here would
        // nag about work the review queue won't even offer.
        .eq("suspended", false)
        .lt("due", heatEndISO);
      if (error) throw error;
      return count ?? 0;
    },
  });

  /**
   * How many cards fall due on each of the next 14 days.
   *
   * Suspended cards are excluded because they won't actually surface, and
   * anything already overdue is folded into "hoje" — that's when you'd face
   * it, regardless of the date printed on the row.
   */
  const { data: forecast = [] } = useQuery({
    queryKey: ["review-forecast", heatEndISO],
    enabled: dateReady,
    queryFn: async () => {
      const horizon = new Date(`${heatEndISO}T00:00:00`);
      horizon.setDate(horizon.getDate() + 14);
      const horizonISO = horizon.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("cards")
        .select("due")
        .eq("suspended", false)
        .lt("due", horizonISO);
      if (error) throw error;

      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        // Overdue collapses onto today rather than showing a past date.
        const key = row.due < heatEndISO ? heatEndISO : row.due;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      const days: { date: string; label: string; count: number }[] = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(`${heatEndISO}T00:00:00`);
        d.setDate(d.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        days.push({
          date: iso,
          label:
            i === 0
              ? "Hoje"
              : capitalizeFirst(
                  d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }),
                ),
          count: counts.get(iso) ?? 0,
        });
      }
      return days;
    },
  });

  const forecastMax = Math.max(1, ...forecast.map((d) => d.count));

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />

        {dateReady ? (
          <div className="flex flex-1 flex-col">
            <header className="flex h-14 items-center gap-3 border-b border-border px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="h-5" />
              <h1 className="text-sm font-medium">Dashboard</h1>
              <div className="ml-auto" />
            </header>

            <main className="flex flex-1 justify-center p-3 sm:p-6">
              <div className="w-full max-w-[1400px] basis-4/5 md:w-4/5">
                {todayFocus && (todayFocus.dueCount > 0 || todayFocus.leechCount > 0) && (
                  <div className="mb-4 rounded-xl border border-border bg-card p-4 sm:p-5">
                    <h2 className="mb-2 text-sm font-medium text-muted-foreground">Foco de hoje</h2>
                    <div className="flex flex-wrap items-center gap-3">
                      {todayFocus.dueCount > 0 && (
                        <p className="text-base">
                          <span className="font-semibold">{todayFocus.dueCount}</span> card(s)
                          pendente(s)
                          {todayFocus.nearestExam && (
                            <>
                              {" — foque em "}
                              <span className="font-semibold">
                                {todayFocus.nearestExam.deckName}
                              </span>
                              {" ("}
                              {todayFocus.nearestExam.dueCount} pendente(s), prova em{" "}
                              {Math.max(
                                0,
                                Math.ceil(
                                  (new Date(
                                    `${todayFocus.nearestExam.examDate}T00:00:00`,
                                  ).getTime() -
                                    Date.now()) /
                                    (1000 * 60 * 60 * 24),
                                ),
                              )}
                              d)
                            </>
                          )}
                        </p>
                      )}
                      {todayFocus.leechCount > 0 && (
                        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
                          {todayFocus.leechCount} leech(es) na fila
                        </span>
                      )}
                      <Link to="/revisoes" className="ml-auto">
                        <Button size="sm">Estudar agora</Button>
                      </Link>
                    </div>
                  </div>
                )}

                <div className="mb-4 flex items-center gap-3">
                  <h2 className="text-xl font-semibold tracking-tight">{monthLabel}</h2>
                  {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => {
                        const d = new Date(viewYear!, viewMonth! - 1, 1);
                        setViewYear(d.getFullYear());
                        setViewMonth(d.getMonth());
                      }}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setViewYear(realNow!.getFullYear());
                        setViewMonth(realNow!.getMonth());
                      }}
                    >
                      Hoje
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => {
                        const d = new Date(viewYear!, viewMonth! + 1, 1);
                        setViewYear(d.getFullYear());
                        setViewMonth(d.getMonth());
                      }}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
                {overdueCount > 0 && (
                  <Link
                    to="/revisoes"
                    className="mb-4 flex items-center justify-between rounded-xl border border-overdue/30 bg-overdue/10 px-4 py-3 text-sm text-overdue transition-colors hover:bg-overdue/20"
                  >
                    <span className="font-medium">
                      {overdueCount} card{overdueCount === 1 ? "" : "s"} atrasado
                      {overdueCount === 1 ? "" : "s"}
                    </span>
                    <span className="text-xs underline">Revisar agora</span>
                  </Link>
                )}
                <div className="mb-4 flex flex-col items-stretch gap-4 overflow-x-auto sm:grid sm:grid-cols-[auto_160px]">
                  {/* Mini calendar heatmap: last 5 weeks, aligned like the main calendar */}
                  <div className="inline-flex flex-col justify-center gap-1.5 justify-self-start rounded-xl border border-border bg-card p-3">
                    <div className="grid grid-cols-7 gap-1.5">
                      {weekDays.map((d) => (
                        <div
                          key={d}
                          className="size-6 text-center text-[10px] font-medium uppercase leading-6 text-muted-foreground"
                        >
                          {d[0]}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {heatCells.map((cell, idx) => {
                        if (!cell) return <div key={idx} className="size-6" />;
                        const bucket =
                          cell.pct >= 100
                            ? 4
                            : cell.pct >= 75
                              ? 3
                              : cell.pct >= 50
                                ? 2
                                : cell.pct >= 25
                                  ? 1
                                  : 0;
                        const colors = [
                          "bg-muted/30",
                          "bg-emerald-100",
                          "bg-emerald-300",
                          "bg-emerald-500",
                          "bg-emerald-700",
                        ];
                        return (
                          <div
                            key={idx}
                            title={`${cell.pct}%`}
                            className={`size-6 rounded ${colors[bucket]}`}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Pie chart for today, in a card matching the main calendar's style */}
                  <div className="flex w-full shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card p-3 sm:w-[160px]">
                    {(() => {
                      const todayArr = (reviewsByDay[today ?? -1] ?? []) as any[];
                      let done = 0;
                      let pending = 0;
                      for (const g of todayArr) {
                        done += g.counts?.done ?? 0;
                        pending += g.counts?.pending ?? 0;
                      }
                      const overdue = overdueCount;
                      const total = done + overdue + pending;
                      const r = 36;
                      const circumference = 2 * Math.PI * r;
                      const segments = [
                        { value: done, color: "#10B981" },
                        { value: overdue, color: "#F97316" },
                        { value: pending, color: "#F59E0B" },
                      ];
                      let offset = 0;
                      return (
                        <svg width={100} height={100} viewBox="0 0 100 100">
                          <circle
                            cx={50}
                            cy={50}
                            r={r}
                            fill="none"
                            stroke="hsl(var(--muted))"
                            strokeWidth={14}
                          />
                          {total > 0 &&
                            segments.map((seg, i) => {
                              if (seg.value === 0) return null;
                              const dash = (seg.value / total) * circumference;
                              const el = (
                                <circle
                                  key={i}
                                  cx={50}
                                  cy={50}
                                  r={r}
                                  fill="none"
                                  stroke={seg.color}
                                  strokeWidth={14}
                                  strokeDasharray={`${dash} ${circumference - dash}`}
                                  strokeDashoffset={-offset}
                                  transform="rotate(-90 50 50)"
                                />
                              );
                              offset += dash;
                              return el;
                            })}
                        </svg>
                      );
                    })()}
                    <div className="text-xs text-muted-foreground">
                      {(() => {
                        const todayArr = (reviewsByDay[today ?? -1] ?? []) as any[];
                        let done = 0;
                        let pending = 0;
                        for (const g of todayArr) {
                          done += g.counts?.done ?? 0;
                          pending += g.counts?.pending ?? 0;
                        }
                        const total = done + overdueCount + pending;
                        return `${done}/${total}`;
                      })()}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border bg-card">
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
                              {/* reviewsByDay[day] is an array of DayGroup {deck, total, counts} */}
                              {((reviewsByDay[day] ?? []) as any[]).map((group, idx) => {
                                // show only top 2; rest will be in 'Outros'
                                if (idx < 2) {
                                  const status: Status =
                                    group.counts?.overdue > 0
                                      ? "overdue"
                                      : group.counts?.done === group.total
                                        ? "done"
                                        : "pending";
                                  return (
                                    <div
                                      key={group.deck}
                                      className={cn(
                                        "truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                                        statusStyles[status],
                                      )}
                                    >
                                      {group.deck} · {group.total}
                                    </div>
                                  );
                                }
                                return null;
                              })}
                              {(() => {
                                const groups = (reviewsByDay[day] ?? []) as any[];
                                if (!groups || groups.length <= 2) return null;
                                const others = groups.slice(2);
                                const otherCount = others.length;
                                const title = others
                                  .map((g) => `${g.deck} · ${g.total}`)
                                  .join("\n");
                                return (
                                  <div className="mt-1">
                                    <button
                                      className="text-[11px] text-muted-foreground underline"
                                      title={title}
                                      onClick={() =>
                                        setShowOthersDay((s) => (s === day ? null : day))
                                      }
                                    >
                                      Outros {otherCount}
                                    </button>
                                    {showOthersDay === day && (
                                      <div className="mt-2 rounded border border-border bg-popover p-2 text-xs">
                                        {others.map((g) => (
                                          <div key={g.deck} className="flex justify-between">
                                            <span>{g.deck}</span>
                                            <span className="text-muted-foreground">{g.total}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Upcoming workload: helps plan around exam weeks. */}
                <div className="mt-4 rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-medium">Próximas revisões</h2>
                  {forecast.every((d) => d.count === 0) ? (
                    <p className="text-sm text-muted-foreground">
                      Nada agendado para os próximos 14 dias.
                    </p>
                  ) : (
                    <div className="flex items-end gap-1 overflow-x-auto">
                      {forecast.map((day) => (
                        <div
                          key={day.date}
                          className="flex min-w-[38px] flex-1 flex-col items-center gap-1"
                          title={`${day.count} card(s)`}
                        >
                          <span className="text-[10px] text-muted-foreground">
                            {day.count > 0 ? day.count : ""}
                          </span>
                          <div
                            className={cn(
                              "w-full rounded-t",
                              day.count > 0 ? "bg-primary" : "bg-muted",
                            )}
                            style={{
                              height: `${Math.max(day.count > 0 ? 6 : 2, (day.count / forecastMax) * 80)}px`,
                            }}
                          />
                          <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                            {day.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </main>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </SidebarProvider>
  );
}