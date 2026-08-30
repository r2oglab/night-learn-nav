import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toLocalDateString } from "@/lib/fsrs";

type DeckRow = { id: string; name: string; parent_id: string | null };

/** deck id -> its root ancestor (id + name) — "módulo" in this app means
 * the top-level deck; subdecks (problems, topics within it) roll up into
 * the root's numbers, since that's the level people actually think in. */
function buildRootMap(decks: DeckRow[]): Map<string, { id: string; name: string }> {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const cache = new Map<string, { id: string; name: string }>();
  function resolveRoot(deckId: string): { id: string; name: string } {
    const cached = cache.get(deckId);
    if (cached) return cached;
    let cur = byId.get(deckId);
    if (!cur) return { id: deckId, name: "Deck removido" };
    while (cur.parent_id && byId.has(cur.parent_id)) {
      cur = byId.get(cur.parent_id) as DeckRow;
    }
    const root = { id: cur.id, name: cur.name };
    cache.set(deckId, root);
    return root;
  }
  const result = new Map<string, { id: string; name: string }>();
  for (const d of decks) result.set(d.id, resolveRoot(d.id));
  return result;
}

/** Overall retention per módulo (root deck), weakest first — "where am I
 * actually struggling" at a glance, across the whole review history. */
export const getModuleComparison = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: decks, error: decksError } = await context.supabase
      .from("decks")
      .select("id,name,parent_id")
      .eq("user_id", context.userId);
    if (decksError) throw new Error(decksError.message);

    const { data: logs, error: logsError } = await context.supabase
      .from("review_logs")
      .select("deck_id,was_correct")
      .eq("user_id", context.userId);
    if (logsError) throw new Error(logsError.message);

    const rootMap = buildRootMap((decks ?? []) as DeckRow[]);
    const byRoot = new Map<string, { name: string; correct: number; total: number }>();
    for (const log of logs ?? []) {
      const root = rootMap.get(log.deck_id) ?? { id: log.deck_id, name: "Deck removido" };
      const entry = byRoot.get(root.id) ?? { name: root.name, correct: 0, total: 0 };
      entry.total++;
      if (log.was_correct) entry.correct++;
      byRoot.set(root.id, entry);
    }

    return [...byRoot.entries()]
      .map(([deckId, { name, correct, total }]) => ({
        deckId,
        name,
        correct,
        total,
        pct: total > 0 ? Math.round((correct / total) * 100) : 0,
      }))
      .sort((a, b) => a.pct - b.pct);
  });

/** Weekly retention trend — for one deck's subtree, or every review if
 * deck_id is omitted. Weeks are 7-day buckets anchored to a fixed Monday,
 * so they line up consistently regardless of when the first review
 * happened, rather than needing real ISO week-number math. */
export const getDeckRetention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deck_id: string | null; tz_offset_minutes: number }) => ({
    deck_id: input.deck_id,
    tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
  }))
  .handler(async ({ data, context }) => {
    let deckIds: string[] | null = null;
    if (data.deck_id) {
      const { data: decks, error: decksError } = await context.supabase
        .from("decks")
        .select("id,parent_id")
        .eq("user_id", context.userId);
      if (decksError) throw new Error(decksError.message);
      const collected: string[] = [];
      const collect = (id: string) => {
        collected.push(id);
        for (const d of decks ?? []) {
          if (d.parent_id === id) collect(d.id);
        }
      };
      collect(data.deck_id);
      deckIds = collected;
    }

    let query = context.supabase
      .from("review_logs")
      .select("was_correct,reviewed_at")
      .eq("user_id", context.userId);
    if (deckIds) query = query.in("deck_id", deckIds);
    const { data: logs, error } = await query;
    if (error) throw new Error(error.message);

    const EPOCH_MONDAY = new Date("2024-01-01T00:00:00Z").getTime(); // a Monday
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const byWeek = new Map<string, { correct: number; total: number }>();
    for (const log of logs ?? []) {
      const localDay = toLocalDateString(new Date(log.reviewed_at), data.tz_offset_minutes);
      const dayMs = new Date(`${localDay}T00:00:00Z`).getTime();
      const weekIndex = Math.floor((dayMs - EPOCH_MONDAY) / WEEK_MS);
      const weekStart = new Date(EPOCH_MONDAY + weekIndex * WEEK_MS).toISOString().slice(0, 10);
      const entry = byWeek.get(weekStart) ?? { correct: 0, total: 0 };
      entry.total++;
      if (log.was_correct) entry.correct++;
      byWeek.set(weekStart, entry);
    }

    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, { correct, total }]) => ({
        weekStart,
        total,
        pct: total > 0 ? Math.round((correct / total) * 100) : 0,
      }));
  });