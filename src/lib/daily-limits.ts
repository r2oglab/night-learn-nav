/**
 * Deciding which due cards actually enter today's queue.
 *
 * Two kinds of cap interact, each with a "total" and a "new cards only"
 * variant:
 *  - a deck's own limit, which applies to that deck *and its whole subtree*
 *  - one global limit, a ceiling on the day's total across every deck
 *
 * Cards already reviewed today count against both, otherwise closing and
 * reopening the app would hand out a fresh allowance each time.
 */

export type LimitDeck = {
  id: string;
  parent_id?: string | null;
  daily_limit?: number | null;
  daily_new_limit?: number | null;
};

export type LimitCard = { id: string; deck_id: string; isNew: boolean };

/** Deck id → its own id plus every ancestor, nearest first. */
export function buildAncestorChains(decks: LimitDeck[]): Map<string, string[]> {
  const parentOf = new Map<string, string | null>();
  for (const d of decks) parentOf.set(d.id, d.parent_id ?? null);

  const chains = new Map<string, string[]>();
  for (const d of decks) {
    const chain: string[] = [];
    let cur: string | null | undefined = d.id;
    // Guard against a cycle from corrupt data rather than looping forever.
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      chain.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    chains.set(d.id, chain);
  }
  return chains;
}

export function applyDailyLimits(params: {
  /** Due cards in the order they should be offered (caller decides priority). */
  dueCards: LimitCard[];
  decks: LimitDeck[];
  /** Global ceiling for the day, or null for unlimited. */
  globalLimit?: number | null;
  /** Global ceiling on new cards specifically, or null for unlimited. */
  globalNewLimit?: number | null;
  /** Cards already reviewed today, used to consume the allowance. */
  reviewedToday?: { deck_id: string; isNew: boolean }[];
}): { allowed: LimitCard[]; blocked: number } {
  const { dueCards, decks, globalLimit, globalNewLimit, reviewedToday = [] } = params;

  const chains = buildAncestorChains(decks);
  const limitOf = new Map<string, number | null>();
  const newLimitOf = new Map<string, number | null>();
  for (const d of decks) {
    limitOf.set(
      d.id,
      typeof d.daily_limit === "number" && d.daily_limit >= 0 ? d.daily_limit : null,
    );
    newLimitOf.set(
      d.id,
      typeof d.daily_new_limit === "number" && d.daily_new_limit >= 0 ? d.daily_new_limit : null,
    );
  }

  const used = new Map<string, number>();
  const usedNew = new Map<string, number>();
  let usedGlobal = 0;
  let usedGlobalNew = 0;

  const consume = (deckId: string, isNew: boolean) => {
    for (const ancestor of chains.get(deckId) ?? [deckId]) {
      used.set(ancestor, (used.get(ancestor) ?? 0) + 1);
      if (isNew) usedNew.set(ancestor, (usedNew.get(ancestor) ?? 0) + 1);
    }
    usedGlobal += 1;
    if (isNew) usedGlobalNew += 1;
  };

  // Today's reviews eat into the same allowance.
  for (const r of reviewedToday) consume(r.deck_id, r.isNew);

  const allowed: LimitCard[] = [];
  let blocked = 0;

  for (const card of dueCards) {
    if (globalLimit != null && usedGlobal >= globalLimit) {
      // The global ceiling is reached — nothing else can come through today.
      blocked += dueCards.length - (allowed.length + blocked);
      break;
    }
    if (card.isNew && globalNewLimit != null && usedGlobalNew >= globalNewLimit) {
      blocked += 1;
      continue;
    }

    const chain = chains.get(card.deck_id) ?? [card.deck_id];
    const capped = chain.some((deckId) => {
      const limit = limitOf.get(deckId);
      if (limit != null && (used.get(deckId) ?? 0) >= limit) return true;
      if (card.isNew) {
        const newLimit = newLimitOf.get(deckId);
        if (newLimit != null && (usedNew.get(deckId) ?? 0) >= newLimit) return true;
      }
      return false;
    });

    if (capped) {
      blocked += 1;
      continue;
    }

    consume(card.deck_id, card.isNew);
    allowed.push(card);
  }

  return { allowed, blocked };
}