/**
 * CSV export, shaped so the result can be fed straight back into this app's
 * own importer (and into Anki).
 *
 * The deck column carries the FULL path ("Medicina::ITU::Prova"), not just
 * the deck's own name — exporting a nested collection and re-importing it
 * has to rebuild the same hierarchy, and a bare name loses that.
 */

export type ExportDeck = { id: string; name: string; parent_id?: string | null };
export type ExportCard = {
  deck_id: string;
  pergunta: string;
  resposta: string;
  due?: string;
  suspended?: boolean | null;
};

/** Quote a field per RFC 4180: wrap in quotes, double any inner quote. */
function csvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: string[][]): string {
  return [header.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))].join(
    "\r\n",
  );
}

/** Full "A::B::C" path for a deck. */
export function deckPathOf(deckId: string, decks: ExportDeck[]): string {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const parts: string[] = [];
  let cur = byId.get(deckId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.push(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return parts.reverse().join("::");
}

/** Every deck id in a subtree, so exporting a parent includes its children. */
export function subtreeDeckIds(rootId: string, decks: ExportDeck[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const d of decks) {
    const p = d.parent_id ?? "__root";
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), d.id]);
  }
  const ids = new Set<string>();
  const walk = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const child of childrenOf.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return ids;
}

/**
 * Build the CSV text for a set of cards. Passing `rootDeckId` narrows the
 * export to that deck and everything beneath it.
 */
export function buildCardsCsv(
  cards: ExportCard[],
  decks: ExportDeck[],
  rootDeckId?: string,
): { csv: string; count: number } {
  const allowed = rootDeckId ? subtreeDeckIds(rootDeckId, decks) : null;
  const selected = allowed ? cards.filter((c) => allowed.has(c.deck_id)) : cards;

  const rows = selected.map((c) => [
    deckPathOf(c.deck_id, decks),
    c.pergunta ?? "",
    c.resposta ?? "",
  ]);

  return { csv: toCsv(["deck", "pergunta", "resposta"], rows), count: rows.length };
}

/** Trigger a browser download for text content. */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/csv;charset=utf-8;",
) {
  // The BOM makes Excel open UTF-8 CSV correctly instead of mangling
  // accents — only relevant for CSV, so skip it for other formats.
  const withBom = mimeType.startsWith("text/csv") ? "\ufeff" + content : content;
  const blob = new Blob([withBom], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}