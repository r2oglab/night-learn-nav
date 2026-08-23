import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Full backup export — every deck and every card, FSRS scheduling state
 * included, trashed cards included too (deleted_at intact). This is a
 * safety net independent of Supabase, not a re-importable format: there's
 * no matching restore path in the app yet, so bringing this back means
 * either re-inserting by hand or building that importer later.
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