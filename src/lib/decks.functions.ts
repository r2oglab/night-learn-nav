import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildDeckTree, type DeckRow } from "./deck-tree";

export const listDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("decks")
      .select(
        "id,user_id,name,parent_id,created_at,daily_limit,sort_order,pinned,exam_date,daily_new_limit",
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