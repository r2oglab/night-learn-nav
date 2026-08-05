import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listThemes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
        .from("themes")
        .select("id,user_id,name,parent_id,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => {
    const path = input.path?.trim();
    if (!path) throw new Error("Informe o caminho do tema.");

    const segments = path
      .split("::")
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) throw new Error("Informe o caminho do tema.");
    if (segments.some((segment) => segment.length > 80))
      throw new Error("Cada nível do tema deve ter no máximo 80 caracteres.");

    return { segments };
  })
  .handler(async ({ data, context }) => {
    let parentId: string | null = null;
    let currentTheme: any = null;

    for (const segment of data.segments) {
      const query = context.supabase
        .from("themes")
        .select("*")
        .eq("user_id", context.userId)
        .eq("name", segment)
        .order("created_at", { ascending: true })
        .limit(1);

      const selectQuery =
        parentId === null
          ? query.is("parent_id", null)
          : query.eq("parent_id", parentId);

      const { data: existingRows, error: selectError } = await selectQuery;
      if (selectError) throw selectError;

      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (existing) {
        currentTheme = existing;
        parentId = existing.id;
        continue;
      }

      const { data: inserted, error: insertError } = await context.supabase
        .from("themes")
        .insert({ user_id: context.userId, name: segment, parent_id: parentId })
        .select("*")
        .single();
      if (insertError) throw insertError;

      currentTheme = inserted;
      parentId = inserted.id;
    }

    return currentTheme;
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
