import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { newCardFields, reviewCard as reviewCardFsrs, type CardRow } from "@/lib/fsrs";
import { cleanupOrphanedCardImages } from "@/lib/card-images";

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
    }) => {
      const deckId = input.deck_id?.trim();
      const pergunta = input.pergunta?.trim();
      const resposta = input.resposta?.trim();
      const invert = !!input.invert;
      const cloze = !!input.cloze;
      if (!deckId) throw new Error("Informe o deck do card.");
      if (!pergunta) throw new Error("Informe a pergunta do card.");
      if (!cloze && !resposta) throw new Error("Informe a resposta do card.");
      return { deck_id: deckId, pergunta, resposta, invert, cloze, typeIn: !!input.typeIn };
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
      ...newCardFields(),
    });

    // if inverted and not cloze, create a swapped card
    if (data.invert && !data.cloze) {
      inserts.push({
        user_id: context.userId,
        deck_id: data.deck_id,
        pergunta: data.resposta,
        resposta: data.pergunta,
        ...newCardFields(),
      });
    }

    const { data: rows, error } = await context.supabase.from("cards").insert(inserts).select("*");
    if (error) throw new Error(error.message);

    // return the first inserted row as primary
    return Array.isArray(rows) ? rows[0] : rows;
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
    // fetch user settings to use desired_retention
    const { data: settings } = await context.supabase
      .from("user_settings")
      .select("desired_retention,last_review_date,streak")
      .eq("user_id", context.userId)
      .maybeSingle();

    const desiredRetention = settings?.desired_retention ?? 0.9;
    const fields = reviewCardFsrs(card as CardRow, data.rating, now, desiredRetention);

    const { data: updated, error: updateError } = await context.supabase
      .from("cards")
      .update(fields)
      .eq("id", data.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    // update user_settings streak / last_review_date
    try {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

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

export const deleteCard = createServerFn({ method: "POST" })
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

    // Occlusion images are shared by every card cut from the same picture,
    // so this only removes the file once no card references it anymore.
    await cleanupOrphanedCardImages(context.supabase, [deleted?.image_url]);

    return deleted;
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
    const { data: updated, error } = await context.supabase
      .from("cards")
      .update({ pergunta: data.pergunta, resposta: data.resposta })
      .eq("id", data.id)
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
  .inputValidator((input: { deck_id: string; image_url: string; regions: OcclusionRegion[] }) => {
    const deckId = input.deck_id?.trim();
    const imageUrl = input.image_url?.trim();
    if (!deckId) throw new Error("Informe o deck.");
    if (!imageUrl) throw new Error("Envie uma imagem.");
    if (!input.regions || input.regions.length === 0)
      throw new Error("Desenhe pelo menos uma área de oclusão.");
    return { deck_id: deckId, image_url: imageUrl, regions: input.regions };
  })
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
      ...newCardFields(),
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
    (input: { cards: { deckPath: string; pergunta: string; resposta: string }[] }) => {
      if (!input.cards || input.cards.length === 0) throw new Error("Nenhum card para importar.");
      if (input.cards.length > 5000)
        throw new Error("Importação limitada a 5000 cards por vez. Divida o arquivo.");
      return { cards: input.cards };
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
        ...newCardFields(),
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
    (input: { card_id: string; image_url?: string | undefined; regions: OcclusionRegion[] }) => {
      const cardId = input.card_id?.trim();
      if (!cardId) throw new Error("Card inválido.");
      if (!input.regions || input.regions.length === 0)
        throw new Error("Mantenha pelo menos uma área de oclusão.");
      return { card_id: cardId, image_url: input.image_url, regions: input.regions };
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
    const { data: siblings, error: siblingsError } = await context.supabase
      .from("cards")
      .select("*")
      .eq("deck_id", anchor.deck_id)
      .eq("image_url", anchor.image_url);
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
        ...newCardFields(),
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
