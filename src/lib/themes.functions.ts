import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { newCardFields, reviewCard, type ThemeRow } from "@/lib/fsrs";

export const listThemes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("themes")
      .select("*")
      .order("due", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => {
    const name = input.name.trim();
    if (!name) throw new Error("Informe o nome do tema.");
    if (name.length > 80) throw new Error("Nome muito longo.");
    return { name };
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("themes")
      .insert({ user_id: context.userId, name: data.name, ...newCardFields() })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const reviewTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; rating: number }) => {
    if (![1, 2, 3, 4].includes(input.rating)) throw new Error("Nota inválida.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: theme, error } = await context.supabase
      .from("themes")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !theme) throw new Error(error?.message ?? "Tema não encontrado.");

    const now = new Date();
    const fields = reviewCard(theme as ThemeRow, data.rating, now);

    const { data: updated, error: updateError } = await context.supabase
      .from("themes")
      .update(fields)
      .eq("id", data.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    await context.supabase.from("revisions").insert({
      theme: theme.name,
      theme_id: theme.id,
      scheduled_date: now.toISOString().slice(0, 10),
      status: "done",
      rating: data.rating,
    });

    return updated;
  });

export const deleteTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("themes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
