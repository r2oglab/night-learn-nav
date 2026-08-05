import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { newCardFields, reviewCard as reviewCardFsrs, type CardRow } from "@/lib/fsrs";

export const listCards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cards")
      .select("*")
      .order("due", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getHeatmapData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { start: string; end: string }) => {
    const start = input.start?.trim();
    const end = input.end?.trim();
    if (!start) throw new Error("Informe a data inicial.");
    if (!end) throw new Error("Informe a data final.");
    return { start, end };
  })
  .handler(async ({ data, context }) => {
    // last_review is a timestamptz; comparing it with a plain date string like
    // "2026-08-05" via .lte() means "<= 2026-08-05 00:00:00", which excludes
    // every review made later that same day. Use an exclusive upper bound of
    // the day AFTER "end" instead, so the whole final day is included.
    const endExclusive = new Date(`${data.end}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const endExclusiveISO = endExclusive.toISOString().slice(0, 10);

    const { data: rows, error } = await context.supabase
      .from("cards")
      .select("id,last_review")
      .gte("last_review", data.start)
      .lt("last_review", endExclusiveISO);
    if (error) throw new Error(error.message);

    const { data: settings } = await context.supabase
      .from("user_settings")
      .select("daily_goal")
      .eq("user_id", context.userId)
      .maybeSingle();

    return {
      rows: rows ?? [],
      dailyGoal: settings?.daily_goal ?? 20,
    };
  });

export const createCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deck_id: string; pergunta: string; resposta?: string; invert?: boolean; cloze?: boolean }) => {
    const deckId = input.deck_id?.trim();
    const pergunta = input.pergunta?.trim();
    const resposta = input.resposta?.trim();
    const invert = !!input.invert;
    const cloze = !!input.cloze;
    if (!deckId) throw new Error("Informe o deck do card.");
    if (!pergunta) throw new Error("Informe a pergunta do card.");
    if (!cloze && !resposta) throw new Error("Informe a resposta do card.");
    return { deck_id: deckId, pergunta, resposta, invert, cloze };
  })
  .handler(async ({ data, context }) => {
    // primary card
    const inserts: any[] = [];
    inserts.push({
      user_id: context.userId,
      deck_id: data.deck_id,
      pergunta: data.pergunta,
      resposta: data.cloze ? data.pergunta : data.resposta,
      ...newCardFields(),
    });

    // if inverted and not cloze, create a swapped card
    if (data.invert && !data.cloze) {
      inserts.push({
        user_id: context.userId,
        deck_id: data.deck_id,
        pergunta: data.resposta,
        resposta: data.pergunta,
        ...newCardFields(),
      });
    }

    const { data: rows, error } = await context.supabase
      .from("cards")
      .insert(inserts)
      .select("*");
    if (error) throw new Error(error.message);

    // return the first inserted row as primary
    return Array.isArray(rows) ? rows[0] : rows;
  });

export const reviewCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; rating: number }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    if (![1, 2, 3, 4].includes(input.rating)) throw new Error("Nota inválida.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: card, error } = await context.supabase
      .from("cards")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !card) throw new Error(error?.message ?? "Card não encontrado.");

    const now = new Date();
    // fetch user settings to use desired_retention
    const { data: settings } = await context.supabase
      .from("user_settings")
      .select("desired_retention,last_review_date,streak")
      .eq("user_id", context.userId)
      .maybeSingle();

    const desiredRetention = settings?.desired_retention ?? 0.9;
    const fields = reviewCardFsrs(card as CardRow, data.rating, now, desiredRetention);

    const { data: updated, error: updateError } = await context.supabase
      .from("cards")
      .update(fields)
      .eq("id", data.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    // update user_settings streak / last_review_date
    try {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const prevDate = settings?.last_review_date ? settings.last_review_date : null;
      const prevStreak = typeof settings?.streak === "number" ? settings.streak : 0;

      let newStreak = prevStreak;
      if (prevDate === todayStr) {
        // already counted today
        newStreak = prevStreak;
      } else if (prevDate === yesterdayStr) {
        newStreak = prevStreak + 1;
      } else {
        newStreak = 1;
      }

      await context.supabase
        .from("user_settings")
        .upsert({ user_id: context.userId, last_review_date: todayStr, streak: newStreak }, { onConflict: "user_id" });
    } catch (e) {
      // non-fatal
      console.warn("Failed to update user_settings streak", e);
    }

    return updated;
  });

export const deleteCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: deleted, error } = await context.supabase
      .from("cards")
      .delete()
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return deleted;
  });

export const updateCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; pergunta: string; resposta: string }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    const pergunta = input.pergunta?.trim();
    const resposta = input.resposta?.trim();
    if (!pergunta) throw new Error("Informe a pergunta do card.");
    if (!resposta) throw new Error("Informe a resposta do card.");
    return { id: input.id, pergunta, resposta };
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ pergunta: data.pergunta, resposta: data.resposta })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });