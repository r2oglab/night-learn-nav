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

export const createCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { theme_id: string; pergunta: string; resposta: string }) => {
    const themeId = input.theme_id?.trim();
    const pergunta = input.pergunta?.trim();
    const resposta = input.resposta?.trim();
    if (!themeId) throw new Error("Informe o tema do card.");
    if (!pergunta) throw new Error("Informe a pergunta do card.");
    if (!resposta) throw new Error("Informe a resposta do card.");
    return { theme_id: themeId, pergunta, resposta };
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("cards")
      .insert({
        user_id: context.userId,
        theme_id: data.theme_id,
        pergunta: data.pergunta,
        resposta: data.resposta,
        ...newCardFields(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
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
    const fields = reviewCardFsrs(card as CardRow, data.rating, now);

    const { data: updated, error: updateError } = await context.supabase
      .from("cards")
      .update(fields)
      .eq("id", data.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    return updated;
  });

export const deleteCard = createServerFn({ method: "DELETE" })
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

export const updateCard = createServerFn({ method: "PATCH" })
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
