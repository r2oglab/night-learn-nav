/**
 * Deciding which due cards actually enter today's queue.
 *
 * Two kinds of cap interact:
 *  - a deck's own limit, which applies to that deck *and its whole subtree*
 *  - one global limit, a ceiling on the day's total across every deck
 *
 * Cards already reviewed today count against both, otherwise closing and
 * reopening the app would hand out a fresh allowance each time.
 */

export type LimitDeck = { id: string; parent_id?: string | null; daily_limit?: number | null };

export type LimitCard = { id: string; deck_id: string };

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
  /** Cards already reviewed today, used to consume the allowance. */
  reviewedTodayDeckIds?: string[];
}): { allowed: LimitCard[]; blocked: number } {
  const { dueCards, decks, globalLimit, reviewedTodayDeckIds = [] } = params;

  const chains = buildAncestorChains(decks);
  const limitOf = new Map<string, number | null>();
  for (const d of decks) {
    limitOf.set(
      d.id,
      typeof d.daily_limit === "number" && d.daily_limit >= 0 ? d.daily_limit : null,
    );
  }

  const used = new Map<string, number>();
  let usedGlobal = 0;

  const consume = (deckId: string) => {
    for (const ancestor of chains.get(deckId) ?? [deckId]) {
      used.set(ancestor, (used.get(ancestor) ?? 0) + 1);
    }
    usedGlobal += 1;
  };

  // Today's reviews eat into the same allowance.
  for (const deckId of reviewedTodayDeckIds) consume(deckId);

  const allowed: LimitCard[] = [];
  let blocked = 0;

  for (const card of dueCards) {
    if (globalLimit != null && usedGlobal >= globalLimit) {
      // The global ceiling is reached — nothing else can come through today.
      blocked += dueCards.length - (allowed.length + blocked);
      break;
    }

    const chain = chains.get(card.deck_id) ?? [card.deck_id];
    const capped = chain.some((deckId) => {
      const limit = limitOf.get(deckId);
      return limit != null && (used.get(deckId) ?? 0) >= limit;
    });

    if (capped) {
      blocked += 1;
      continue;
    }

    consume(card.deck_id);
    allowed.push(card);
  }

  return { allowed, blocked };
}
