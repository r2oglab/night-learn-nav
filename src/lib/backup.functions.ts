import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Full backup export — every deck and every card, FSRS scheduling state
 * included, trashed cards included too (deleted_at intact). Safety net
 * independent of Supabase. Same {decks, cards} shape that
 * previewJsonImport/applyJsonImport read back in, so this doubles as the
 * source file for "Restaurar"/"Mesclar" in Criação.
 */
export const exportFullBackup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: decks, error: decksError } = await context.supabase
      .from("decks")
      .select("*")
      .eq("user_id", context.userId);
    if (decksError) throw new Error(decksError.message);

    const { data: cards, error: cardsError } = await context.supabase
      .from("cards")
      .select("*")
      .eq("user_id", context.userId);
    if (cardsError) throw new Error(cardsError.message);

    const { data: settings, error: settingsError } = await context.supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);

    return {
      exported_at: new Date().toISOString(),
      app: "MedReview",
      format_version: 1,
      decks: decks ?? [],
      cards: cards ?? [],
      user_settings: settings ?? null,
    };
  });

/**
 * Same {decks, cards} shape as exportFullBackup, narrowed to one deck and
 * everything beneath it — the JSON counterpart to the per-deck CSV export
 * in Flashcards, and importable back via the same "Restaurar"/"Mesclar"
 * flow in Criação (full fidelity: FSRS state, tags, notes, occlusion —
 * CSV only ever carried pergunta/resposta).
 */
export const exportDeckBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deck_id: string }) => {
    if (!input.deck_id?.trim()) throw new Error("ID do deck inválido.");
    return { deck_id: input.deck_id };
  })
  .handler(async ({ data, context }) => {
    const { data: allDecks, error: allDecksError } = await context.supabase
      .from("decks")
      .select("*")
      .eq("user_id", context.userId);
    if (allDecksError) throw new Error(allDecksError.message);

    const subtreeIds: string[] = [];
    const collect = (id: string) => {
      subtreeIds.push(id);
      for (const d of allDecks ?? []) {
        if ((d as { parent_id: string | null }).parent_id === id) {
          collect((d as { id: string }).id);
        }
      }
    };
    collect(data.deck_id);

    const decks = (allDecks ?? []).filter((d) => subtreeIds.includes((d as { id: string }).id));

    const { data: cards, error: cardsError } = await context.supabase
      .from("cards")
      .select("*")
      .eq("user_id", context.userId)
      .in("deck_id", subtreeIds);
    if (cardsError) throw new Error(cardsError.message);

    return {
      exported_at: new Date().toISOString(),
      app: "MedReview",
      format_version: 1,
      decks,
      cards: cards ?? [],
      user_settings: null,
    };
  });