/**
 * Minimal RFC-4180-style CSV parser.
 *
 * Written by hand rather than pulling in a dependency, because the cases
 * that actually matter here are narrow and worth being explicit about:
 * quoted fields containing the delimiter, escaped quotes (""), and newlines
 * inside quoted fields — all of which Anki produces when a card's text has
 * commas or line breaks in it.
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM — Excel adds one and it would otherwise become part
  // of the first header cell.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }

    if (char === "\r") {
      i++;
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }

    field += char;
    i++;
  }

  // Flush whatever is left when the file doesn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully blank lines, which are common at the end of exported files.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Guess the delimiter by counting candidates in the first line. Anki
 * exports tab-separated by default, but plenty of tools emit commas or
 * semicolons (the latter common in pt-BR locales), so guessing beats
 * forcing the user to know which one they have.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const candidates = ["\t", ";", ","];
  let best = ",";
  let bestCount = 0;
  for (const c of candidates) {
    const count = firstLine.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

export type ParsedCardRow = {
  deckPath: string;
  pergunta: string;
  resposta: string;
};

/**
 * Interpret already-parsed CSV rows as cards.
 *
 * Column meaning is positional and deliberately forgiving:
 *   1 column  -> pergunta only (no answer; rejected later)
 *   2 columns -> pergunta, resposta
 *   3+        -> deck, pergunta, resposta  (extra columns ignored)
 *
 * `hasHeader` drops the first row. `defaultDeck` is used whenever a row
 * doesn't carry its own deck path.
 */
export function rowsToCards(
  rows: string[][],
  opts: { hasHeader: boolean; defaultDeck: string; deckColumnFirst: boolean },
): { cards: ParsedCardRow[]; skipped: number } {
  const body = opts.hasHeader ? rows.slice(1) : rows;
  const cards: ParsedCardRow[] = [];
  let skipped = 0;

  for (const row of body) {
    let deckPath = opts.defaultDeck;
    let pergunta = "";
    let resposta = "";

    if (opts.deckColumnFirst && row.length >= 3) {
      deckPath = (row[0] ?? "").trim() || opts.defaultDeck;
      pergunta = (row[1] ?? "").trim();
      resposta = (row[2] ?? "").trim();
    } else {
      pergunta = (row[0] ?? "").trim();
      resposta = (row[1] ?? "").trim();
    }

    if (!pergunta || !resposta || !deckPath) {
      skipped++;
      continue;
    }
    cards.push({ deckPath, pergunta, resposta });
  }

  return { cards, skipped };
}