import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildDeckTree, type DeckRow } from "./deck-tree";
import { cleanupOrphanedCardImages } from "@/lib/card-images";

export const listDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("decks")
      .select(
        "id,user_id,name,parent_id,created_at,daily_limit,sort_order,pinned,exam_date,daily_new_limit,archived",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as DeckRow[];
  });

export const listDeckTree = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("decks")
      .select("id,user_id,name,parent_id,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as DeckRow[];
    return buildDeckTree(rows);
  });

export const createDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => {
    const path = input.path?.trim();
    if (!path) throw new Error("Informe o caminho do deck.");

    const segments = path
      .split("::")
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) throw new Error("Informe o caminho do deck.");
    if (segments.some((segment) => segment.length > 80))
      throw new Error("Cada nível do deck deve ter no máximo 80 caracteres.");

    return { segments };
  })
  .handler(async ({ data, context }) => {
    let parentId: string | null = null;
    let currentDeck: DeckRow | null = null;

    for (const segment of data.segments) {
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
      if (selectError) throw selectError;

      const existing = Array.isArray(existingRows) ? (existingRows[0] as DeckRow) : null;
      if (existing) {
        currentDeck = existing;
        parentId = existing.id;
        continue;
      }

      const { data: inserted, error: insertError } = await context.supabase
        .from("decks")
        .insert({ user_id: context.userId, name: segment, parent_id: parentId })
        .select("*")
        .single();
      if (insertError) throw insertError;

      currentDeck = inserted as DeckRow;
      parentId = currentDeck.id;
    }

    return currentDeck;
  });

export const deleteDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    // Soft-delete, not a real DELETE: this deck and its subtree just get
    // deleted_at set, same as a card would. A real DELETE here would rely
    // on ON DELETE CASCADE, which doesn't check deleted_at — it would wipe
    // out cards that were already safely sitting in the trash. Images
    // aren't touched either, for the same reason cleanupOrphanedCardImages
    // only runs on a card's *permanent* delete, not its trash move.
    const { data: allDecks } = await context.supabase
      .from("decks")
      .select("id,parent_id")
      .eq("user_id", context.userId);

    const descendantIds: string[] = [];
    const collect = (parentId: string) => {
      descendantIds.push(parentId);
      for (const d of allDecks ?? []) {
        if (d.parent_id === parentId) collect(d.id);
      }
    };
    collect(data.id);

    const now = new Date().toISOString();

    const { error: deckError } = await context.supabase
      .from("decks")
      .update({ deleted_at: now })
      .in("id", descendantIds)
      .eq("user_id", context.userId);
    if (deckError) throw new Error(deckError.message);

    const { error: cardsError } = await context.supabase
      .from("cards")
      .update({ deleted_at: now })
      .in("deck_id", descendantIds)
      .eq("user_id", context.userId)
      .is("deleted_at", null);
    if (cardsError) throw new Error(cardsError.message);

    return { ok: true };
  });

/** Trashed decks, most recently deleted first. Piggybacks on the same
 * 30-day sweep that already runs from listTrashedCards — no separate purge
 * job needed. */
export const listTrashedDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: expired } = await context.supabase
      .from("decks")
      .select("id")
      .eq("user_id", context.userId)
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);

    if (expired && expired.length > 0) {
      await context.supabase
        .from("decks")
        .delete()
        .in(
          "id",
          expired.map((d: { id: string }) => d.id),
        )
        .eq("user_id", context.userId);
    }

    const { data, error } = await context.supabase
      .from("decks")
      .select("*")
      .eq("user_id", context.userId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as DeckRow[];
  });

/** Restores a deck, plus only the cards trashed in the exact same batch —
 * matched by an identical deleted_at timestamp, which deleteDeck sets on
 * both together. Cards that were already in the trash on their own, before
 * the deck was deleted, are left alone: restoring the deck shouldn't
 * resurrect something the person deliberately trashed earlier. */
export const restoreDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id?.trim()) throw new Error("ID do deck inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: deck, error: fetchError } = await context.supabase
      .from("decks")
      .select("deleted_at")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (fetchError) throw new Error(fetchError.message);
    if (!deck?.deleted_at) throw new Error("Deck não está na lixeira.");

    const { error: deckError } = await context.supabase
      .from("decks")
      .update({ deleted_at: null })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (deckError) throw new Error(deckError.message);

    const { error: cardsError } = await context.supabase
      .from("cards")
      .update({ deleted_at: null })
      .eq("deck_id", data.id)
      .eq("user_id", context.userId)
      .eq("deleted_at", deck.deleted_at);
    if (cardsError) throw new Error(cardsError.message);

    return { ok: true };
  });

/** Real deletion — only reachable from the deck trash view. Both FKs
 * (decks.parent_id and cards.deck_id) cascade, so deleting just the root
 * here still correctly removes the whole subdeck/card subtree; only the
 * image cleanup needs the descendant ids collected by hand. */
export const permanentlyDeleteDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id?.trim()) throw new Error("ID do deck inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: allDecks } = await context.supabase
      .from("decks")
      .select("id,parent_id")
      .eq("user_id", context.userId);

    const descendantIds: string[] = [];
    const collect = (parentId: string) => {
      descendantIds.push(parentId);
      for (const d of allDecks ?? []) {
        if (d.parent_id === parentId) collect(d.id);
      }
    };
    collect(data.id);

    const { data: doomedCards } = await context.supabase
      .from("cards")
      .select("image_url")
      .in("deck_id", descendantIds)
      .not("image_url", "is", null);

    const { error } = await context.supabase
      .from("decks")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    await cleanupOrphanedCardImages(
      context.supabase,
      (doomedCards ?? []).map((c: { image_url: string | null }) => c.image_url),
    );

    return { ok: true };
  });

export const setDeckPinned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; pinned: boolean }) => {
    if (!input.id?.trim()) throw new Error("ID do deck inválido.");
    return { id: input.id, pinned: !!input.pinned };
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("decks")
      .update({ pinned: data.pinned })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/** Archives (or unarchives) a deck — a module that's done but worth
 * keeping, not something to delete. The `archived` flag itself lives only
 * on the deck node the person archived; what actually keeps its cards out
 * of Revisões/Dashboard/due-counts is suspending them, which every one of
 * those queries already excludes — so archiving needs no new query
 * anywhere else. Walks the whole subtree (a módulo's subdecks included),
 * since that's the level people actually archive at. */
export const setDeckArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; archived: boolean }) => {
    if (!input.id?.trim()) throw new Error("ID do deck inválido.");
    return { id: input.id, archived: !!input.archived };
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("decks")
      .update({ archived: data.archived })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { data: allDecks } = await context.supabase
      .from("decks")
      .select("id,parent_id")
      .eq("user_id", context.userId);
    const subtreeIds: string[] = [];
    const collect = (id: string) => {
      subtreeIds.push(id);
      for (const d of allDecks ?? []) {
        if (d.parent_id === id) collect(d.id);
      }
    };
    collect(data.id);

    const { error: cardsError } = await context.supabase
      .from("cards")
      .update({ suspended: data.archived })
      .in("deck_id", subtreeIds)
      .eq("user_id", context.userId)
      .is("deleted_at", null);
    if (cardsError) throw new Error(cardsError.message);

    return updated;
  });

/** Persists a full sibling group's order in one call — the caller (moving
 * one deck up or down) recomputes sequential values for every sibling, not
 * just the two that swapped, so ordering stays deterministic instead of
 * accumulating null/tied sort_order gaps over time. */
export const reorderDecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orders: { id: string; sort_order: number }[] }) => {
    const orders = (input.orders ?? []).filter((o) => o?.id);
    if (orders.length === 0) throw new Error("Nada para reordenar.");
    return { orders };
  })
  .handler(async ({ data, context }) => {
    // Supabase JS has no multi-row "different value per row" update in one
    // call, so this is one UPDATE per deck — fine at sibling-list scale.
    for (const o of data.orders) {
      const { error } = await context.supabase
        .from("decks")
        .update({ sort_order: o.sort_order })
        .eq("id", o.id)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const updateDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      name: string;
      daily_limit?: number | null;
      daily_new_limit?: number | null;
      exam_date?: string | null;
    }) => {
      const id = input.id?.trim();
      const name = input.name?.trim();
      if (!id) throw new Error("ID do deck inválido.");
      if (!name) throw new Error("Informe o nome do deck.");
      if (name.length > 80) throw new Error("Nome muito longo.");
      // undefined = leave as is · null = clear the limit · number = set it
      function parseLimit(value: number | null | undefined): number | null | undefined {
        if (value === null) return null;
        if (typeof value !== "number") return undefined;
        if (!Number.isFinite(value) || value < 0) throw new Error("Limite diário inválido.");
        return Math.floor(value);
      }
      const dailyLimit = parseLimit(input.daily_limit);
      const dailyNewLimit = parseLimit(input.daily_new_limit);
      let examDate: string | null | undefined;
      if (input.exam_date === null) examDate = null;
      else if (typeof input.exam_date === "string" && input.exam_date.trim()) {
        examDate = input.exam_date.trim();
      }
      return {
        id,
        name,
        daily_limit: dailyLimit,
        daily_new_limit: dailyNewLimit,
        exam_date: examDate,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const patch: {
      name: string;
      daily_limit?: number | null;
      daily_new_limit?: number | null;
      exam_date?: string | null;
    } = { name: data.name };
    if (data.daily_limit !== undefined) patch.daily_limit = data.daily_limit;
    if (data.daily_new_limit !== undefined) patch.daily_new_limit = data.daily_new_limit;
    if (data.exam_date !== undefined) patch.exam_date = data.exam_date;

    const { data: row, error } = await context.supabase
      .from("decks")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });