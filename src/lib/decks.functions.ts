import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildDeckTree, type DeckRow } from "./deck-tree";
import { cleanupOrphanedCardImages } from "@/lib/card-images";

export const listDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("decks")
      .select("id,user_id,name,parent_id,created_at")
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
    // Deleting a deck cascades to its subdecks and all their cards, so the
    // image URLs have to be read BEFORE the delete — afterwards those rows
    // are gone and there's nothing left to look up.
    const { data: allDecks } = await context.supabase.from("decks").select("id,parent_id");

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

    const { error } = await context.supabase.from("decks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await cleanupOrphanedCardImages(
      context.supabase,
      (doomedCards ?? []).map((c: { image_url: string | null }) => c.image_url),
    );

    return { ok: true };
  });

export const updateDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; name: string; daily_limit?: number | null }) => {
    const id = input.id?.trim();
    const name = input.name?.trim();
    if (!id) throw new Error("ID do deck inválido.");
    if (!name) throw new Error("Informe o nome do deck.");
    if (name.length > 80) throw new Error("Nome muito longo.");
    // undefined = leave as is · null = clear the limit · number = set it
    let dailyLimit: number | null | undefined;
    if (input.daily_limit === null) dailyLimit = null;
    else if (typeof input.daily_limit === "number") {
      if (!Number.isFinite(input.daily_limit) || input.daily_limit < 0)
        throw new Error("Limite diário inválido.");
      dailyLimit = Math.floor(input.daily_limit);
    }
    return { id, name, daily_limit: dailyLimit };
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("decks")
      .update(
        data.daily_limit === undefined
          ? { name: data.name }
          : { name: data.name, daily_limit: data.daily_limit },
      )
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
