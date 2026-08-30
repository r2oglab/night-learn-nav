import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  newCardFields,
  reviewCard as reviewCardFsrs,
  toLocalDateString,
  type CardRow,
} from "@/lib/fsrs";
import { cleanupOrphanedCardImages } from "@/lib/card-images";

export const listCards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cards")
      .select("*")
      .is("deleted_at", null)
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
      .is("deleted_at", null)
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
  .inputValidator(
    (input: {
      deck_id: string;
      pergunta: string;
      resposta?: string;
      invert?: boolean;
      cloze?: boolean;
      typeIn?: boolean;
      image_url?: string | undefined;
      image_placement?: "frente" | "verso" | "ambos" | undefined;
      tags?: string[] | undefined;
      tz_offset_minutes: number;
    }) => {
      const deckId = input.deck_id?.trim();
      const pergunta = input.pergunta?.trim();
      const resposta = input.resposta?.trim();
      const invert = !!input.invert;
      const cloze = !!input.cloze;
      if (!deckId) throw new Error("Informe o deck do card.");
      if (!pergunta) throw new Error("Informe a pergunta do card.");
      if (!cloze && !resposta) throw new Error("Informe a resposta do card.");
      const placement =
        input.image_placement === "verso" || input.image_placement === "ambos"
          ? input.image_placement
          : "frente";
      const tags = Array.from(new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean)));
      return {
        deck_id: deckId,
        pergunta,
        resposta,
        invert,
        cloze,
        typeIn: !!input.typeIn,
        image_url: input.image_url?.trim() || undefined,
        image_placement: placement,
        tags,
        tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
      };
    },
  )
  .handler(async ({ data, context }) => {
    // primary card
    const inserts: any[] = [];
    inserts.push({
      user_id: context.userId,
      deck_id: data.deck_id,
      pergunta: data.pergunta,
      resposta: data.cloze ? data.pergunta : data.resposta,
      card_type: data.typeIn ? "digitar" : null,
      image_url: data.image_url ?? null,
      image_placement: data.image_url ? data.image_placement : null,
      tags: data.tags,
      ...newCardFields(data.tz_offset_minutes),
    });

    // If inverted and not cloze, create a swapped card. The picture was
    // placed relative to the ORIGINAL pergunta/resposta text, and that text
    // swaps sides on card 2 (its front is card 1's back, and vice versa) —
    // so "frente" flips to "verso" and back, while "ambos" needs no change.
    if (data.invert && !data.cloze) {
      const swappedPlacement =
        data.image_placement === "frente"
          ? "verso"
          : data.image_placement === "verso"
            ? "frente"
            : data.image_placement;
      inserts.push({
        user_id: context.userId,
        deck_id: data.deck_id,
        pergunta: data.resposta,
        resposta: data.pergunta,
        image_url: data.image_url ?? null,
        image_placement: data.image_url ? swappedPlacement : null,
        tags: data.tags,
        ...newCardFields(data.tz_offset_minutes),
      });
    }

    const { data: rows, error } = await context.supabase.from("cards").insert(inserts).select("*");
    if (error) throw new Error(error.message);

    // return the first inserted row as primary
    return Array.isArray(rows) ? rows[0] : rows;
  });

export const reviewCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; rating: number; tz_offset_minutes: number }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    if (![1, 2, 3, 4].includes(input.rating)) throw new Error("Nota inválida.");
    return {
      ...input,
      tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
    };
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
    const fields = reviewCardFsrs(
      card as CardRow,
      data.rating,
      now,
      data.tz_offset_minutes,
      desiredRetention,
    );

    // Snapshot the pre-grading FSRS fields so a mis-tap can be undone.
    const prevState = {
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsed_days,
      scheduled_days: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      last_review: card.last_review,
    };

    const { data: updated, error: updateError } = await context.supabase
      .from("cards")
      .update({ ...fields, prev_state: prevState })
      .eq("id", data.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    // Log the review for retention stats (estatísticas). Non-fatal: if
    // review_logs hasn't been migrated in yet, the review itself still
    // goes through — this only feeds a feature that doesn't exist yet.
    try {
      await context.supabase.from("review_logs").insert({
        user_id: context.userId,
        card_id: data.id,
        deck_id: card.deck_id,
        rating: data.rating,
        was_correct: data.rating !== 1, // Rating.Again
        reviewed_at: now.toISOString(),
      });
    } catch (e) {
      console.warn("Failed to write review_logs", e);
    }

    // update user_settings streak / last_review_date — same local-calendar
    // fix as the due date: "today" has to mean the user's today, not the
    // server's UTC today, or a late-night review could snap the streak.
    try {
      const today = new Date();
      const todayStr = toLocalDateString(today, data.tz_offset_minutes);
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = toLocalDateString(yesterday, data.tz_offset_minutes);

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
        .upsert(
          { user_id: context.userId, last_review_date: todayStr, streak: newStreak },
          { onConflict: "user_id" },
        );
    } catch (e) {
      // non-fatal
      console.warn("Failed to update user_settings streak", e);
    }

    return updated;
  });

/** Moves a card to the trash — sets deleted_at instead of deleting it for
 * real, so it drops out of listCards (and everywhere that reads from it)
 * but can still be restored. Image cleanup doesn't run here: the row still
 * exists, so cleanupOrphanedCardImages correctly sees the image as still
 * in use. */
export const deleteCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

const TRASH_AUTO_PURGE_DAYS = 30;

/** Lists trashed cards, and lazily hard-deletes anything past the purge
 * window first — a lightweight sweep instead of a scheduled job, since
 * there's no cron infra in this app. Trashed decks are swept the same way,
 * but from listTrashedDecks — that's the screen that actually shows them. */
export const listTrashedCards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cutoff = new Date(Date.now() - TRASH_AUTO_PURGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: expired } = await context.supabase
      .from("cards")
      .select("id, image_url")
      .eq("user_id", context.userId)
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);

    if (expired && expired.length > 0) {
      const ids = expired.map((c: { id: string }) => c.id);
      await context.supabase.from("cards").delete().in("id", ids).eq("user_id", context.userId);
      await cleanupOrphanedCardImages(
        context.supabase,
        expired.map((c: { image_url: string | null }) => c.image_url),
      );
    }

    const { data, error } = await context.supabase
      .from("cards")
      .select("*")
      .eq("user_id", context.userId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const restoreCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ deleted_at: null })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/** Real deletion — only reachable from the trash view. Same cleanup the old
 * deleteCard used to do unconditionally. */
export const permanentlyDeleteCard = createServerFn({ method: "POST" })
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
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await cleanupOrphanedCardImages(context.supabase, [deleted?.image_url]);

    return deleted;
  });

/** Clones a card as a fresh, unscheduled card — a duplicate is a starting
 * point for a variant, not a copy of the original's study progress. */
export const duplicateCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; tz_offset_minutes: number }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    return {
      id: input.id,
      tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: original, error: fetchError } = await context.supabase
      .from("cards")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (fetchError) throw new Error(fetchError.message);
    if (!original) throw new Error("Card não encontrado.");

    const { data: inserted, error } = await context.supabase
      .from("cards")
      .insert({
        user_id: context.userId,
        deck_id: original.deck_id,
        pergunta: original.pergunta,
        resposta: original.resposta,
        card_type: original.card_type,
        image_url: original.image_url,
        image_placement: original.image_placement,
        // Occlusion cards are defined by these two fields — copying the
        // image without them would produce a card the review screen reads
        // as a plain image card, i.e. a broken duplicate.
        occlusion_regions: original.occlusion_regions,
        occlusion_target_id: original.occlusion_target_id,
        tags: original.tags,
        note: original.note,
        ...newCardFields(data.tz_offset_minutes),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

/** Bulk move — same deck-move a single card gets, applied to many at once. */
export const bulkMoveCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[]; deck_id: string }) => {
    const ids = (input.ids ?? []).filter(Boolean);
    if (ids.length === 0) throw new Error("Nenhum card selecionado.");
    if (!input.deck_id?.trim()) throw new Error("Informe o deck de destino.");
    return { ids, deck_id: input.deck_id };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("cards")
      .update({ deck_id: data.deck_id })
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { count: data.ids.length };
  });

export const bulkSetSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[]; suspended: boolean }) => {
    const ids = (input.ids ?? []).filter(Boolean);
    if (ids.length === 0) throw new Error("Nenhum card selecionado.");
    return { ids, suspended: !!input.suspended };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("cards")
      .update({ suspended: data.suspended })
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { count: data.ids.length };
  });

export const bulkDeleteCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) => {
    const ids = (input.ids ?? []).filter(Boolean);
    if (ids.length === 0) throw new Error("Nenhum card selecionado.");
    return { ids };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("cards")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { count: data.ids.length };
  });

function buildReplacer(find: string, replace: string, caseSensitive: boolean) {
  if (caseSensitive) {
    return (text: string) => text.split(find).join(replace);
  }
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gi");
  return (text: string) => text.replace(re, replace);
}

/** Preview which cards contain the search term, before committing to the
 * replace — bulk text edits are easy to get wrong once, worth seeing the
 * blast radius first. */
export const previewFindReplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { find: string; case_sensitive?: boolean }) => {
    const find = input.find ?? "";
    if (!find.trim()) throw new Error("Informe o termo a buscar.");
    return { find, case_sensitive: !!input.case_sensitive };
  })
  .handler(async ({ data, context }) => {
    const { data: cards, error } = await context.supabase
      .from("cards")
      .select("id,pergunta,resposta,deck_id")
      .eq("user_id", context.userId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    const needle = data.case_sensitive ? data.find : data.find.toLowerCase();
    const matches = (cards ?? []).filter((c) => {
      const hay = `${c.pergunta}\n${c.resposta}`;
      return (data.case_sensitive ? hay : hay.toLowerCase()).includes(needle);
    });
    return matches;
  });

/** Applies the replace to every matching card's pergunta/resposta, and
 * logs each change to card_edit_logs like a normal edit would. */
export const applyFindReplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { find: string; replace: string; case_sensitive?: boolean }) => {
    const find = input.find ?? "";
    if (!find.trim()) throw new Error("Informe o termo a buscar.");
    return { find, replace: input.replace ?? "", case_sensitive: !!input.case_sensitive };
  })
  .handler(async ({ data, context }) => {
    const { data: cards, error } = await context.supabase
      .from("cards")
      .select("id,pergunta,resposta")
      .eq("user_id", context.userId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    const apply = buildReplacer(data.find, data.replace, data.case_sensitive);

    let count = 0;
    for (const card of cards ?? []) {
      const newPergunta = apply(card.pergunta);
      const newResposta = apply(card.resposta);
      if (newPergunta === card.pergunta && newResposta === card.resposta) continue;

      const { error: updErr } = await context.supabase
        .from("cards")
        .update({ pergunta: newPergunta, resposta: newResposta })
        .eq("id", card.id)
        .eq("user_id", context.userId);
      if (updErr) throw new Error(updErr.message);
      count++;

      try {
        await context.supabase.from("card_edit_logs").insert({
          user_id: context.userId,
          card_id: card.id,
          previous_pergunta: card.pergunta,
          previous_resposta: card.resposta,
          new_pergunta: newPergunta,
          new_resposta: newResposta,
        });
      } catch (e) {
        console.warn("Failed to write card_edit_logs", e);
      }
    }
    return { count };
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
    // Fetch the pre-edit text first so the log captures a real before/after,
    // not just the after. Best-effort: a failed fetch here shouldn't block
    // the actual edit from going through.
    const { data: before } = await context.supabase
      .from("cards")
      .select("pergunta,resposta")
      .eq("id", data.id)
      .maybeSingle();

    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ pergunta: data.pergunta, resposta: data.resposta })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    if (before && (before.pergunta !== data.pergunta || before.resposta !== data.resposta)) {
      try {
        await context.supabase.from("card_edit_logs").insert({
          user_id: context.userId,
          card_id: data.id,
          previous_pergunta: before.pergunta,
          previous_resposta: before.resposta,
          new_pergunta: data.pergunta,
          new_resposta: data.resposta,
        });
      } catch (e) {
        console.warn("Failed to write card_edit_logs", e);
      }
    }

    return updated;
  });

/** History of pergunta/resposta edits for one card, most recent first. */
export const listCardEditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { card_id: string }) => {
    if (!input.card_id?.trim()) throw new Error("ID do card inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("card_edit_logs")
      .select("*")
      .eq("card_id", data.card_id)
      .eq("user_id", context.userId)
      .order("edited_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

function normalizePair(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

/** Links two cards (undirected — order doesn't matter). Silently no-ops if
 * the pair is already linked, since a duplicate click shouldn't error. */
export const linkCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { card_id_a: string; card_id_b: string }) => {
    if (!input.card_id_a?.trim() || !input.card_id_b?.trim())
      throw new Error("IDs de card inválidos.");
    if (input.card_id_a === input.card_id_b)
      throw new Error("Um card não pode se relacionar com ele mesmo.");
    const [card_a_id, card_b_id] = normalizePair(input.card_id_a, input.card_id_b);
    return { card_a_id, card_b_id };
  })
  .handler(async ({ data, context }) => {
    // Both cards must belong to this user — without this, a crafted request
    // could link an owned card to someone else's card id, then read that
    // card's content back through listCardLinks below.
    const { data: owned, error: ownedError } = await context.supabase
      .from("cards")
      .select("id")
      .in("id", [data.card_a_id, data.card_b_id])
      .eq("user_id", context.userId);
    if (ownedError) throw new Error(ownedError.message);
    if ((owned ?? []).length !== 2) throw new Error("Card não encontrado.");

    const { error } = await context.supabase.from("card_links").insert({
      user_id: context.userId,
      card_a_id: data.card_a_id,
      card_b_id: data.card_b_id,
    });
    // 23505 = unique_violation — already linked, treat as success.
    if (error && (error as { code?: string }).code !== "23505") throw new Error(error.message);
    return { ok: true };
  });

export const unlinkCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { card_id_a: string; card_id_b: string }) => {
    if (!input.card_id_a?.trim() || !input.card_id_b?.trim())
      throw new Error("IDs de card inválidos.");
    const [card_a_id, card_b_id] = normalizePair(input.card_id_a, input.card_id_b);
    return { card_a_id, card_b_id };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("card_links")
      .delete()
      .eq("card_a_id", data.card_a_id)
      .eq("card_b_id", data.card_b_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** The other card in every link this card is part of, with just enough
 * fields to show a chip and open a preview. */
export const listCardLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { card_id: string }) => {
    if (!input.card_id?.trim()) throw new Error("ID do card inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: links, error } = await context.supabase
      .from("card_links")
      .select("card_a_id,card_b_id")
      .eq("user_id", context.userId)
      .or(`card_a_id.eq.${data.card_id},card_b_id.eq.${data.card_id}`);
    if (error) throw new Error(error.message);

    const otherIds = (links ?? []).map((l) =>
      l.card_a_id === data.card_id ? l.card_b_id : l.card_a_id,
    );
    if (otherIds.length === 0) return [];

    const { data: otherCards, error: cardsError } = await context.supabase
      .from("cards")
      .select("id,pergunta,resposta,deck_id")
      .in("id", otherIds)
      .eq("user_id", context.userId)
      .is("deleted_at", null);
    if (cardsError) throw new Error(cardsError.message);
    return otherCards ?? [];
  });

/** Edits just the tags — separate from updateCard so tagging a card never
 * requires touching pergunta/resposta, and works for every card type
 * (oclusão, importado, gerado por IA) even though only manual creation
 * accepts tags up front. */
export const updateCardTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; tags: string[] }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    const tags = Array.from(new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean)));
    return { id: input.id, tags };
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ tags: data.tags })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/** Personal note per card — a mnemonic or reminder, never shown during
 * review, editable independently of pergunta/resposta/tags. */
export const updateCardNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; note: string }) => {
    if (!input.id?.trim()) throw new Error("ID do card inválido.");
    const note = (input.note ?? "").trim();
    return { id: input.id, note: note || null };
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ note: data.note })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

type OcclusionRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | undefined;
};

export const createImageOcclusionCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      deck_id: string;
      image_url: string;
      regions: OcclusionRegion[];
      tz_offset_minutes: number;
    }) => {
      const deckId = input.deck_id?.trim();
      const imageUrl = input.image_url?.trim();
      if (!deckId) throw new Error("Informe o deck.");
      if (!imageUrl) throw new Error("Envie uma imagem.");
      if (!input.regions || input.regions.length === 0)
        throw new Error("Desenhe pelo menos uma área de oclusão.");
      return {
        deck_id: deckId,
        image_url: imageUrl,
        regions: input.regions,
        tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
      };
    },
  )
  .handler(async ({ data, context }) => {
    // "Hide all, guess one": every card generated from this image carries
    // the full regions array (so all masks render on the front), but each
    // card's own occlusion_target_id says which single mask gets lifted
    // once that specific card is revealed.
    const inserts = data.regions.map((region) => ({
      user_id: context.userId,
      deck_id: data.deck_id,
      pergunta: region.label ? `[Oclusão] ${region.label}` : "[Oclusão de imagem]",
      resposta: region.label ?? "",
      image_url: data.image_url,
      occlusion_regions: data.regions,
      occlusion_target_id: region.id,
      ...newCardFields(data.tz_offset_minutes),
    }));

    const { data: rows, error } = await context.supabase.from("cards").insert(inserts).select("*");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Bulk-create plain cards from an already-parsed CSV.
 *
 * Deck paths are resolved once per distinct path (not once per row), since
 * an import of a few hundred cards typically spans only a handful of decks
 * and each resolution walks the hierarchy segment by segment.
 */
export const importCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      cards: { deckPath: string; pergunta: string; resposta: string }[];
      tz_offset_minutes: number;
      tags?: string[];
    }) => {
      if (!input.cards || input.cards.length === 0) throw new Error("Nenhum card para importar.");
      if (input.cards.length > 5000)
        throw new Error("Importação limitada a 5000 cards por vez. Divida o arquivo.");
      const tags = Array.from(new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean)));
      return {
        cards: input.cards,
        tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
        tags,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const deckIdByPath = new Map<string, string>();

    async function resolveDeckPath(path: string): Promise<string> {
      const cached = deckIdByPath.get(path);
      if (cached) return cached;

      const segments = path
        .split("::")
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length === 0) throw new Error(`Caminho de deck inválido: "${path}"`);

      let parentId: string | null = null;
      let deckId = "";

      for (const segment of segments) {
        const query = context.supabase
          .from("decks")
          .select("*")
          .eq("user_id", context.userId)
          .eq("name", segment)
          .order("created_at", { ascending: true })
          .limit(1);

        const selectQuery: any =
          parentId === null ? query.is("parent_id", null) : query.eq("parent_id", parentId);

        const { data: existingRows, error: selectError } = await selectQuery;
        if (selectError) throw new Error(selectError.message);

        const existing = Array.isArray(existingRows) ? existingRows[0] : null;
        if (existing) {
          deckId = existing.id;
          parentId = existing.id;
          continue;
        }

        const { data: created, error: insertError } = await context.supabase
          .from("decks")
          .insert({ user_id: context.userId, name: segment, parent_id: parentId })
          .select("*")
          .single();
        if (insertError) throw new Error(insertError.message);

        deckId = created.id;
        parentId = created.id;
      }

      deckIdByPath.set(path, deckId);
      return deckId;
    }

    const inserts: any[] = [];
    for (const card of data.cards) {
      const deckId = await resolveDeckPath(card.deckPath);
      inserts.push({
        user_id: context.userId,
        deck_id: deckId,
        pergunta: card.pergunta,
        resposta: card.resposta,
        tags: data.tags,
        ...newCardFields(data.tz_offset_minutes),
      });
    }

    // Insert in chunks so one oversized request can't blow past payload
    // limits partway through and leave the import half-applied silently.
    const CHUNK = 500;
    let imported = 0;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const chunk = inserts.slice(i, i + CHUNK);
      const { error } = await context.supabase.from("cards").insert(chunk);
      if (error) throw new Error(`Falha após importar ${imported} card(s): ${error.message}`);
      imported += chunk.length;
    }

    return { imported, decks: deckIdByPath.size };
  });

/**
 * Replace the mask layout (and optionally the image) of an existing
 * occlusion set.
 *
 * All cards sharing `occlusion_target_id` values from one image are updated
 * together: regions whose id survives keep their card (and its FSRS
 * scheduling), removed regions have their card deleted, and newly drawn
 * regions get a fresh card. Rewriting every card from scratch would reset
 * review history the user has already built up.
 */
export const updateImageOcclusion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      card_id: string;
      image_url?: string | undefined;
      regions: OcclusionRegion[];
      tz_offset_minutes: number;
    }) => {
      const cardId = input.card_id?.trim();
      if (!cardId) throw new Error("Card inválido.");
      if (!input.regions || input.regions.length === 0)
        throw new Error("Mantenha pelo menos uma área de oclusão.");
      return {
        card_id: cardId,
        image_url: input.image_url,
        regions: input.regions,
        tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { data: anchor, error: anchorError } = await context.supabase
      .from("cards")
      .select("*")
      .eq("id", data.card_id)
      .single();
    if (anchorError || !anchor) throw new Error(anchorError?.message ?? "Card não encontrado.");
    if (!anchor.image_url) throw new Error("Este card não é de oclusão de imagem.");

    // Every card generated from the same picture shares its image_url.
    // Trashed siblings are deliberately excluded: syncing regions shouldn't
    // resurrect a card the person put in the trash, and it definitely
    // shouldn't hard-delete it just because its region is no longer kept.
    const { data: siblings, error: siblingsError } = await context.supabase
      .from("cards")
      .select("*")
      .eq("deck_id", anchor.deck_id)
      .eq("image_url", anchor.image_url)
      .is("deleted_at", null);
    if (siblingsError) throw new Error(siblingsError.message);

    const imageUrl = data.image_url?.trim() || anchor.image_url;
    const keptIds = new Set(data.regions.map((r) => r.id));
    const existingByTarget = new Map<string, any>();
    for (const row of siblings ?? []) {
      if (row.occlusion_target_id) existingByTarget.set(row.occlusion_target_id, row);
    }

    // 1. Remove cards whose region no longer exists.
    const toDelete = (siblings ?? [])
      .filter((row: any) => row.occlusion_target_id && !keptIds.has(row.occlusion_target_id))
      .map((row: any) => row.id);
    if (toDelete.length > 0) {
      const { error } = await context.supabase.from("cards").delete().in("id", toDelete);
      if (error) throw new Error(error.message);
    }

    // 2. Update the cards that survive, preserving their FSRS state.
    for (const region of data.regions) {
      const existing = existingByTarget.get(region.id);
      if (!existing) continue;
      const { error } = await context.supabase
        .from("cards")
        .update({
          pergunta: region.label ? `[Oclusão] ${region.label}` : "[Oclusão de imagem]",
          resposta: region.label ?? "",
          image_url: imageUrl,
          occlusion_regions: data.regions,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    }

    // 3. Create cards for regions drawn since the last save.
    const newRegions = data.regions.filter((r) => !existingByTarget.has(r.id));
    if (newRegions.length > 0) {
      const inserts = newRegions.map((region) => ({
        user_id: context.userId,
        deck_id: anchor.deck_id,
        pergunta: region.label ? `[Oclusão] ${region.label}` : "[Oclusão de imagem]",
        resposta: region.label ?? "",
        image_url: imageUrl,
        occlusion_regions: data.regions,
        occlusion_target_id: region.id,
        ...newCardFields(data.tz_offset_minutes),
      }));
      const { error } = await context.supabase.from("cards").insert(inserts);
      if (error) throw new Error(error.message);
    }

    // If the picture itself was replaced, the old file may now be unused.
    if (imageUrl !== anchor.image_url) {
      await cleanupOrphanedCardImages(context.supabase, [anchor.image_url]);
    }

    return { updated: data.regions.length, removed: toDelete.length, added: newRegions.length };
  });

/**
 * Roll a card back to the FSRS state it had before its last grading.
 *
 * Only one level deep: `prev_state` is overwritten on every review, which
 * covers the case this exists for — hitting the wrong button and noticing
 * immediately. Undoing twice in a row is refused rather than silently
 * restoring the same snapshot again.
 */
export const undoReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id?.trim()) throw new Error("Card inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: card, error } = await context.supabase
      .from("cards")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !card) throw new Error(error?.message ?? "Card não encontrado.");
    if (!card.prev_state) throw new Error("Não há avaliação para desfazer neste card.");

    const prev = card.prev_state as Record<string, unknown>;
    const { data: restored, error: updateError } = await context.supabase
      .from("cards")
      .update({ ...prev, prev_state: null })
      .eq("id", data.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);
    return restored;
  });

/**
 * Push a card's due date out by N days, counted from today rather than from
 * its current due date — a card three weeks overdue should land N days from
 * now, not N days after a date already in the past.
 */
export const postponeCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; days: number; tz_offset_minutes: number }) => {
    if (!input.id?.trim()) throw new Error("Card inválido.");
    const days = Math.round(input.days);
    if (!Number.isFinite(days) || days < 1 || days > 3650)
      throw new Error("Informe de 1 a 3650 dias.");
    return {
      id: input.id,
      days,
      tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
    };
  })
  .handler(async ({ data, context }) => {
    // Establish "today" in the user's own calendar first (same fix as card
    // scheduling), THEN add whole days on a noon-UTC anchor so the addition
    // itself can't drift onto the wrong date.
    const todayStr = toLocalDateString(new Date(), data.tz_offset_minutes);
    const anchor = new Date(`${todayStr}T12:00:00Z`);
    anchor.setUTCDate(anchor.getUTCDate() + data.days);
    const due = anchor.toISOString().slice(0, 10);

    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ due })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/**
 * Suspend or unsuspend a card. Suspended cards keep their scheduling but
 * are skipped by the review queue, which is the point: park a card that
 * needs fixing without losing its history.
 */
export const setCardSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; suspended: boolean }) => {
    if (!input.id?.trim()) throw new Error("Card inválido.");
    return { id: input.id, suspended: !!input.suspended };
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ suspended: data.suspended })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });