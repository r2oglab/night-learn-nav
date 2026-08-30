import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toLocalDateString } from "@/lib/fsrs";
import { LEECH_THRESHOLD } from "@/lib/leech";

type FocusDeck = { id: string; name: string; parent_id: string | null; exam_date: string | null };

/** deck id -> ids of itself and every descendant. */
function buildDescendants(decks: FocusDeck[]): Map<string, Set<string>> {
  const childrenOf = new Map<string, string[]>();
  for (const d of decks) {
    if (!d.parent_id) continue;
    const list = childrenOf.get(d.parent_id) ?? [];
    list.push(d.id);
    childrenOf.set(d.parent_id, list);
  }
  const result = new Map<string, Set<string>>();
  for (const d of decks) {
    const set = new Set<string>([d.id]);
    const stack = [...(childrenOf.get(d.id) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || set.has(id)) continue;
      set.add(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    result.set(d.id, set);
  }
  return result;
}

/**
 * "O que estudar hoje" — cruza cards vencidos, leeches, e a prova mais
 * próxima com cards pendentes num único resumo, em vez de deixar a pessoa
 * juntar isso olhando três telas diferentes.
 */
export const getTodayFocus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tz_offset_minutes: number }) => ({
    tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
  }))
  .handler(async ({ data, context }) => {
    const { data: decks, error: decksError } = await context.supabase
      .from("decks")
      .select("id,name,parent_id,exam_date")
      .eq("user_id", context.userId);
    if (decksError) throw new Error(decksError.message);

    const { data: cards, error: cardsError } = await context.supabase
      .from("cards")
      .select("id,deck_id,due,lapses,suspended")
      .eq("user_id", context.userId)
      .is("deleted_at", null);
    if (cardsError) throw new Error(cardsError.message);

    const todayISO = toLocalDateString(new Date(), data.tz_offset_minutes);
    const dueCards = (cards ?? []).filter((c) => !c.suspended && c.due <= todayISO);
    const leechCount = dueCards.filter((c) => (c.lapses ?? 0) >= LEECH_THRESHOLD).length;

    // Nearest exam among decks that actually have due cards under them —
    // an exam with nothing pending isn't something to "focus on" today.
    const descendants = buildDescendants((decks ?? []) as FocusDeck[]);
    let nearest: { deckName: string; examDate: string; dueCount: number } | null = null;
    for (const deck of (decks ?? []) as FocusDeck[]) {
      if (!deck.exam_date) continue;
      const ids = descendants.get(deck.id) ?? new Set([deck.id]);
      const dueCount = dueCards.filter((c) => ids.has(c.deck_id)).length;
      if (dueCount === 0) continue;
      if (!nearest || deck.exam_date < nearest.examDate) {
        nearest = { deckName: deck.name, examDate: deck.exam_date, dueCount };
      }
    }

    return {
      dueCount: dueCards.length,
      leechCount,
      nearestExam: nearest,
    };
  });

/** Longest study streak ever, plus total distinct days studied — both
 * derived from review_logs, same source of truth as "sequência atual" in
 * user_settings but looking at the whole history instead of just today's
 * running count. */
export const getStreakStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tz_offset_minutes: number }) => ({
    tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
  }))
  .handler(async ({ data, context }) => {
    const { data: logs, error } = await context.supabase
      .from("review_logs")
      .select("reviewed_at")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    const days = new Set<string>();
    for (const row of logs ?? []) {
      days.add(toLocalDateString(new Date(row.reviewed_at), data.tz_offset_minutes));
    }
    const sorted = [...days].sort();

    let longest = 0;
    let longestStart: string | null = null;
    let longestEnd: string | null = null;
    let runStart = "";
    let runLen = 0;
    let prev: string | null = null;
    for (const day of sorted) {
      const isConsecutive = prev
        ? (() => {
            const nextDay = new Date(`${prev}T00:00:00`);
            nextDay.setDate(nextDay.getDate() + 1);
            return nextDay.toISOString().slice(0, 10) === day;
          })()
        : false;
      if (isConsecutive) {
        runLen++;
      } else {
        runLen = 1;
        runStart = day;
      }
      if (runLen > longest) {
        longest = runLen;
        longestStart = runStart;
        longestEnd = day;
      }
      prev = day;
    }

    return { longest, longestStart, longestEnd, totalStudyDays: sorted.length };
  });