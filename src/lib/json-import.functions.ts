import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { newCardFields } from "@/lib/fsrs";
import type { Json } from "@/integrations/supabase/types";

/**
 * Shapes match exportFullBackup's `select("*")` output — every column, but
 * typed loosely (only the fields this module actually reads are named)
 * since the input comes from a JSON file someone hands us, not a query we
 * control.
 */
type BackupDeck = {
  id: string;
  name: string;
  parent_id: string | null;
  daily_limit?: number | null;
  daily_new_limit?: number | null;
  exam_date?: string | null;
  pinned?: boolean;
};

type BackupCard = {
  id: string;
  deck_id: string;
  pergunta: string;
  resposta: string;
  deleted_at?: string | null;
  tags?: string[] | null;
  note?: string | null;
  card_type?: string | null;
  image_url?: string | null;
  occlusion_regions?: unknown;
  occlusion_target_id?: string | null;
  image_placement?: string | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string | null;
  suspended?: boolean;
  explanation?: string | null;
};

type ImportMode = "restore" | "merge";

function validateBackup(input: unknown): { decks: BackupDeck[]; cards: BackupCard[] } {
  const obj = input as { decks?: unknown; cards?: unknown } | null;
  if (!obj || !Array.isArray(obj.decks) || !Array.isArray(obj.cards)) {
    throw new Error("Arquivo não parece um backup do Estuda (esperava decks/cards).");
  }
  return { decks: obj.decks as BackupDeck[], cards: obj.cards as BackupCard[] };
}

/** Orders backup decks so a parent always comes before its children —
 * needed for both modes, since inserting a deck with a not-yet-existing
 * parent_id would fail the foreign key. */
function topologicalDeckOrder(decks: BackupDeck[]): BackupDeck[] {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const ordered: BackupDeck[] = [];
  const seen = new Set<string>();
  function visit(deck: BackupDeck) {
    if (seen.has(deck.id)) return;
    seen.add(deck.id);
    if (deck.parent_id && byId.has(deck.parent_id)) visit(byId.get(deck.parent_id) as BackupDeck);
    ordered.push(deck);
  }
  for (const d of decks) visit(d);
  return ordered;
}

export const previewJsonImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mode: ImportMode; decks: unknown; cards: unknown }) => {
    if (input.mode !== "restore" && input.mode !== "merge") {
      throw new Error("Modo de import inválido.");
    }
    const { decks, cards } = validateBackup({ decks: input.decks, cards: input.cards });
    return { mode: input.mode, decks, cards };
  })
  .handler(async ({ data, context }) => {
    if (data.mode === "merge") {
      // Everything becomes a new row either way — the only useful preview
      // is how much there is, and how many deck paths it touches.
      const paths = new Set(data.decks.map((d) => d.id));
      return {
        mode: "merge" as const,
        deckCount: paths.size,
        cardCount: data.cards.filter((c) => !c.deleted_at).length,
      };
    }

    const [{ data: existingDecks }, { data: existingCards }] = await Promise.all([
      context.supabase.from("decks").select("id").eq("user_id", context.userId),
      context.supabase.from("cards").select("id").eq("user_id", context.userId),
    ]);
    const existingDeckIds = new Set((existingDecks ?? []).map((d: { id: string }) => d.id));
    const existingCardIds = new Set((existingCards ?? []).map((c: { id: string }) => c.id));

    const missingDecks = data.decks.filter((d) => !existingDeckIds.has(d.id));
    const missingCards = data.cards.filter((c) => !existingCardIds.has(c.id));

    return {
      mode: "restore" as const,
      missingDeckCount: missingDecks.length,
      missingCardCount: missingCards.length,
      missingDeckNames: missingDecks.slice(0, 20).map((d) => d.name),
      alreadyPresentDeckCount: data.decks.length - missingDecks.length,
      alreadyPresentCardCount: data.cards.length - missingCards.length,
    };
  });

export const applyJsonImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mode: ImportMode; decks: unknown; cards: unknown }) => {
    if (input.mode !== "restore" && input.mode !== "merge") {
      throw new Error("Modo de import inválido.");
    }
    const { decks, cards } = validateBackup({ decks: input.decks, cards: input.cards });
    return { mode: input.mode, decks, cards };
  })
  .handler(async ({ data, context }) => {
    if (data.mode === "restore") {
      const [{ data: existingDecks }, { data: existingCards }] = await Promise.all([
        context.supabase.from("decks").select("id").eq("user_id", context.userId),
        context.supabase.from("cards").select("id").eq("user_id", context.userId),
      ]);
      const existingDeckIds = new Set((existingDecks ?? []).map((d: { id: string }) => d.id));
      const existingCardIds = new Set((existingCards ?? []).map((c: { id: string }) => c.id));

      const missingDecks = topologicalDeckOrder(
        data.decks.filter((d) => !existingDeckIds.has(d.id)),
      );
      let deckCount = 0;
      for (const deck of missingDecks) {
        const { error } = await context.supabase.from("decks").insert({
          id: deck.id,
          user_id: context.userId,
          name: deck.name,
          parent_id: deck.parent_id,
          daily_limit: deck.daily_limit ?? null,
          daily_new_limit: deck.daily_new_limit ?? null,
          exam_date: deck.exam_date ?? null,
          pinned: deck.pinned ?? false,
          deleted_at: null,
          archived: false,
        });
        // A missing parent (itself not in this backup, and not restored
        // above) would fail the FK — skip that one deck rather than abort
        // the whole restore over it.
        if (!error) deckCount++;
      }

      const missingCards = data.cards.filter((c) => !existingCardIds.has(c.id));
      let cardCount = 0;
      const CHUNK = 500;
      for (let i = 0; i < missingCards.length; i += CHUNK) {
        const chunk = missingCards.slice(i, i + CHUNK).map((c) => ({
          id: c.id,
          user_id: context.userId,
          deck_id: c.deck_id,
          pergunta: c.pergunta,
          resposta: c.resposta,
          tags: c.tags ?? [],
          note: c.note ?? null,
          card_type: c.card_type ?? null,
          image_url: c.image_url ?? null,
          occlusion_regions: (c.occlusion_regions ?? null) as Json,
          occlusion_target_id: c.occlusion_target_id ?? null,
          image_placement: c.image_placement ?? null,
          due: c.due,
          stability: c.stability,
          difficulty: c.difficulty,
          elapsed_days: c.elapsed_days,
          scheduled_days: c.scheduled_days,
          reps: c.reps,
          lapses: c.lapses,
          state: c.state,
          last_review: c.last_review ?? null,
          suspended: c.suspended ?? false,
          explanation: c.explanation ?? null,
          deleted_at: null,
        }));
        const { error, count } = await context.supabase
          .from("cards")
          .insert(chunk, { count: "exact" });
        if (!error) cardCount += count ?? chunk.length;
      }

      return { mode: "restore" as const, deckCount, cardCount };
    }

    // Merge: every deck/card becomes a NEW row. Decks are matched by
    // name+parent against what already exists (same rule createDeck uses
    // for "::" paths), so merging into an existing module just adds to it
    // instead of duplicating it.
    const orderedBackupDecks = topologicalDeckOrder(data.decks);
    const idMap = new Map<string, string>(); // backup deck id -> real deck id (new or matched)

    for (const deck of orderedBackupDecks) {
      const newParentId = deck.parent_id ? (idMap.get(deck.parent_id) ?? null) : null;

      const query = context.supabase
        .from("decks")
        .select("id")
        .eq("user_id", context.userId)
        .eq("name", deck.name)
        .order("created_at", { ascending: true })
        .limit(1);
      const scoped =
        newParentId === null ? query.is("parent_id", null) : query.eq("parent_id", newParentId);
      const { data: existingRows } = await scoped;
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;

      if (existing) {
        idMap.set(deck.id, (existing as { id: string }).id);
        continue;
      }

      const { data: inserted, error } = await context.supabase
        .from("decks")
        .insert({ user_id: context.userId, name: deck.name, parent_id: newParentId })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      idMap.set(deck.id, (inserted as { id: string }).id);
    }

    const tzOffsetMinutes = 0; // merge always starts cards fresh — see note below.
    const mergeableCards = data.cards.filter((c) => !c.deleted_at && idMap.has(c.deck_id));
    let cardCount = 0;
    const CHUNK = 500;
    for (let i = 0; i < mergeableCards.length; i += CHUNK) {
      const chunk = mergeableCards.slice(i, i + CHUNK).map((c) => ({
        user_id: context.userId,
        deck_id: idMap.get(c.deck_id) as string,
        pergunta: c.pergunta,
        resposta: c.resposta,
        tags: c.tags ?? [],
        note: c.note ?? null,
        card_type: c.card_type ?? null,
        image_url: c.image_url ?? null,
        occlusion_regions: (c.occlusion_regions ?? null) as Json,
        occlusion_target_id: c.occlusion_target_id ?? null,
        image_placement: c.image_placement ?? null,
        // Someone else's study progress isn't yours — every merged card
        // starts fresh, same as a CSV import would, instead of carrying
        // over their FSRS state.
        ...newCardFields(tzOffsetMinutes),
      }));
      const { error, count } = await context.supabase
        .from("cards")
        .insert(chunk, { count: "exact" });
      if (error) throw new Error(error.message);
      cardCount += count ?? chunk.length;
    }

    return { mode: "merge" as const, deckCount: idMap.size, cardCount };
  });

/**
 * Third shape: bulk creation from a nested JSON (deck -> subdecks -> cards,
 * front/back instead of pergunta/resposta, no ids, no FSRS state). This is
 * what "generate flashcards organized by deck" naturally produces — a tree
 * is the obvious way to represent that without inventing IDs, unlike the
 * flat {decks,cards} shape exportFullBackup uses. Every card here is new;
 * FSRS always starts fresh, same as CSV import.
 */
type StructuredCard = {
  type?: string | null;
  front: string;
  back: string;
  tags?: string[] | null;
  has_image?: boolean;
  image_note?: string | null;
};
type StructuredNode = {
  name: string;
  subdecks?: StructuredNode[];
  cards?: StructuredCard[];
};

function isStructuredShape(input: unknown): input is { decks: StructuredNode[] } {
  const obj = input as { decks?: unknown } | null;
  if (!obj || !Array.isArray(obj.decks)) return false;
  // The flat backup shape also has a top-level "decks" array, but its
  // entries have "id"/"parent_id", never "subdecks" or nested "cards" —
  // checking for either of those is enough to tell the shapes apart.
  return obj.decks.every(
    (d) => d && typeof d === "object" && ("subdecks" in d || "cards" in d) && !("id" in d),
  );
}

/** Flattens the tree into one entry per node that actually holds cards,
 * each carrying its full "A::B::C" path — same "::" convention createDeck
 * already parses, so path resolution below reuses that exact matching
 * rule (existing deck with that name+parent wins, otherwise create it). */
function flattenStructured(
  nodes: StructuredNode[],
  prefix: string[],
): { path: string[]; cards: StructuredCard[] }[] {
  const out: { path: string[]; cards: StructuredCard[] }[] = [];
  for (const node of nodes) {
    if (!node?.name) continue;
    const path = [...prefix, node.name];
    if (node.cards && node.cards.length > 0) out.push({ path, cards: node.cards });
    if (node.subdecks && node.subdecks.length > 0) {
      out.push(...flattenStructured(node.subdecks, path));
    }
  }
  return out;
}

function mapCardType(type: string | null | undefined): string | null {
  // "invertido" cards in this format already arrive as a separate,
  // pre-swapped front/back row — nothing left to invert, it's a plain
  // card. "cloze" likewise: the {{c::}} markup (if present) is detected
  // from the text itself elsewhere in the app, not from a stored type.
  // "digitar" is the one type this app actually persists.
  return type === "digitar" ? "digitar" : null;
}

export const previewStructuredImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { data: unknown }) => {
    if (!isStructuredShape(input.data)) {
      throw new Error("Arquivo não parece esse formato de criação em massa.");
    }
    return { decks: input.data.decks };
  })
  .handler(async ({ data }) => {
    const groups = flattenStructured(data.decks, []);
    const cardCount = groups.reduce((sum, g) => sum + g.cards.length, 0);
    const imageWarningCount = groups.reduce(
      (sum, g) => sum + g.cards.filter((c) => c.has_image).length,
      0,
    );
    return {
      deckPathCount: groups.length,
      cardCount,
      imageWarningCount,
      samplePaths: groups.slice(0, 20).map((g) => g.path.join("::")),
    };
  });

export const applyStructuredImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { data: unknown; tz_offset_minutes: number }) => {
    if (!isStructuredShape(input.data)) {
      throw new Error("Arquivo não parece esse formato de criação em massa.");
    }
    return {
      decks: input.data.decks,
      tz_offset_minutes: Number.isFinite(input.tz_offset_minutes) ? input.tz_offset_minutes : 0,
    };
  })
  .handler(async ({ data, context }) => {
    const groups = flattenStructured(data.decks, []);
    const deckIdByPath = new Map<string, string>();

    async function resolvePath(segments: string[]): Promise<string> {
      let parentId: string | null = null;
      let currentId = "";
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) continue;
        const partialKey = segments.slice(0, i + 1).join("::");
        const partialCached = deckIdByPath.get(partialKey);
        if (partialCached) {
          parentId = partialCached;
          currentId = partialCached;
          continue;
        }

        const query = context.supabase
          .from("decks")
          .select("id")
          .eq("user_id", context.userId)
          .eq("name", segment)
          .order("created_at", { ascending: true })
          .limit(1);
        const scoped =
          parentId === null ? query.is("parent_id", null) : query.eq("parent_id", parentId);
        const { data: existingRows } = await scoped;
        const existing = Array.isArray(existingRows) ? existingRows[0] : null;

        if (existing) {
          currentId = (existing as { id: string }).id;
        } else {
          const { data: inserted, error } = await context.supabase
            .from("decks")
            .insert({ user_id: context.userId, name: segment, parent_id: parentId })
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          currentId = (inserted as { id: string }).id;
        }
        deckIdByPath.set(partialKey, currentId);
        parentId = currentId;
      }
      return currentId;
    }

    let deckCount = 0;
    let cardCount = 0;
    let imageWarningCount = 0;
    const CHUNK = 500;

    for (const group of groups) {
      const deckId = await resolvePath(group.path);
      deckCount++;

      const rows = group.cards.map((c) => {
        const hasImage = !!c.has_image;
        if (hasImage) imageWarningCount++;
        return {
          user_id: context.userId,
          deck_id: deckId,
          pergunta: c.front,
          resposta: c.back,
          tags: [...(c.tags ?? []), ...(hasImage ? ["sem-imagem"] : [])],
          note: hasImage && c.image_note ? `Imagem pendente: ${c.image_note}` : null,
          card_type: mapCardType(c.type),
          ...newCardFields(data.tz_offset_minutes),
        };
      });

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error, count } = await context.supabase
          .from("cards")
          .insert(chunk, { count: "exact" });
        if (error) throw new Error(error.message);
        cardCount += count ?? chunk.length;
      }
    }

    return { deckCount, cardCount, imageWarningCount };
  });