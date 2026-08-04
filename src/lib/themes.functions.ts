import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listThemes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("themes")
      .select("id,user_id,name,created_at")
      .order("created_at", { ascending: false });
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
      .insert({ user_id: context.userId, name: data.name })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("themes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateTheme = createServerFn({ method: "PATCH" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; name: string }) => {
    const id = input.id?.trim();
    const name = input.name?.trim();
    if (!id) throw new Error("ID do tema inválido.");
    if (!name) throw new Error("Informe o nome do tema.");
    if (name.length > 80) throw new Error("Nome muito longo.");
    return { id, name };
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("themes")
      .update({ name: data.name })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
