export type DeckRow = {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  sort_order?: number | null;
  pinned?: boolean;
};

/** Fixed decks first, then by sort_order (nulls last — never-reordered
 * decks fall back to alphabetical among themselves). Used everywhere
 * sibling decks are listed, so pin/reorder shows up consistently in every
 * tree view. */
export function compareDecks(a: DeckRow, b: DeckRow): number {
  const aPinned = a.pinned ? 0 : 1;
  const bPinned = b.pinned ? 0 : 1;
  if (aPinned !== bPinned) return aPinned - bPinned;
  const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.name.localeCompare(b.name);
}

export type DeckNode = DeckRow & {
  children: DeckNode[];
  depth: number;
};

export function isRootDeck(deck: DeckRow): boolean {
  return deck.parent_id === null;
}

export function getDeckChildren(decks: DeckRow[], parentId: string | null): DeckRow[] {
  return decks.filter((deck) => deck.parent_id === parentId);
}

export function buildDeckTree(decks: DeckRow[]): DeckNode[] {
  const deckMap = new Map<string, DeckNode>();

  for (const deck of decks) {
    deckMap.set(deck.id, { ...deck, children: [], depth: 0 });
  }

  const roots: DeckNode[] = [];

  for (const deck of deckMap.values()) {
    if (deck.parent_id) {
      const parent = deckMap.get(deck.parent_id);
      if (parent) {
        parent.children.push(deck);
      } else {
        roots.push(deck);
      }
    } else {
      roots.push(deck);
    }
  }

  function setDepth(node: DeckNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) {
      setDepth(child, depth + 1);
    }
  }

  for (const root of roots) {
    setDepth(root, 0);
  }

  const sortRecursive = (nodes: DeckNode[]) => {
    nodes.sort(compareDecks);
    for (const node of nodes) sortRecursive(node.children);
  };
  sortRecursive(roots);

  return roots;
}

export function findRootDeck(deck: DeckRow, allDecks: DeckRow[]): DeckRow {
  const deckById = new Map(allDecks.map((item) => [item.id, item]));
  let current: DeckRow | undefined = deck;
  while (current?.parent_id) {
    current = deckById.get(current.parent_id);
  }
  return current ?? deck;
}

export function walkDeckTree(node: DeckNode, callback: (deck: DeckNode) => void): void {
  callback(node);
  for (const child of node.children) {
    walkDeckTree(child, callback);
  }
}

export function flattenDeckTree(nodes: DeckNode[]): DeckNode[] {
  const flattened: DeckNode[] = [];
  for (const node of nodes) {
    walkDeckTree(node, (deck) => flattened.push(deck));
  }
  return flattened;
}