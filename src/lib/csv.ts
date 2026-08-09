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
  opts: {
    hasHeader: boolean;
    defaultDeck: string;
    deckColumnFirst: boolean;
    /** Strip Anki field HTML and rewrite {{cN::}} markers. On by default. */
    ankiCleanup?: boolean;
    /** 1-based index of a column holding a deck path (Anki "tags column"). */
    deckFromColumn?: number | undefined;
  },
): { cards: ParsedCardRow[]; skipped: number } {
  const body = opts.hasHeader ? rows.slice(1) : rows;
  const cards: ParsedCardRow[] = [];
  const cleanup = opts.ankiCleanup !== false;
  let skipped = 0;

  const normalize = (value: string) =>
    cleanup ? convertAnkiCloze(stripHtml(value)).trim() : value.trim();

  for (const row of body) {
    let deckPath = opts.defaultDeck;
    let pergunta = "";
    let resposta = "";

    if (opts.deckColumnFirst && row.length >= 3) {
      deckPath = (row[0] ?? "").trim() || opts.defaultDeck;
      pergunta = normalize(row[1] ?? "");
      resposta = normalize(row[2] ?? "");
    } else {
      pergunta = normalize(row[0] ?? "");
      resposta = normalize(row[1] ?? "");

      // A dedicated deck/tags column (Anki records its index in the header)
      // is nested under the default deck rather than replacing it, so an
      // import always stays grouped under one top-level name the user chose.
      if (opts.deckFromColumn) {
        const raw = (row[opts.deckFromColumn - 1] ?? "").trim();
        if (raw) {
          const firstTag = raw.split(/\s+/)[0] ?? raw;
          // Anki tags are often already prefixed with the deck name
          // ("ITU::fixacao" under a default deck of "ITU"); nesting blindly
          // would produce "ITU::ITU::fixacao".
          deckPath =
            firstTag === opts.defaultDeck || firstTag.startsWith(`${opts.defaultDeck}::`)
              ? firstTag
              : `${opts.defaultDeck}::${firstTag}`;
        }
      }
    }

    if (!pergunta || !resposta || !deckPath) {
      skipped++;
      continue;
    }
    cards.push({ deckPath, pergunta, resposta });
  }

  return { cards, skipped };
}

/**
 * Metadata Anki writes as `#key:value` lines above the data in a real
 * .txt/.csv export. Anki itself uses these on re-import, so honouring them
 * means a file exported straight from Anki lands correctly with no manual
 * fiddling.
 */
export type AnkiHeader = {
  separator?: string;
  deck?: string;
  /** 1-based column index Anki assigns to tags / deck / the note columns. */
  tagsColumn?: number;
  deckColumn?: number;
  html?: boolean;
};

const SEPARATOR_WORDS: Record<string, string> = {
  tab: "\t",
  comma: ",",
  semicolon: ";",
  space: " ",
  pipe: "|",
  colon: ":",
};

/**
 * Split a raw export into its `#` metadata block and the data beneath it.
 * Anki puts these lines first; anything else is left untouched.
 */
export function extractAnkiHeader(text: string): { header: AnkiHeader; body: string } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/);
  const header: AnkiHeader = {};
  let consumed = 0;

  for (const line of lines) {
    if (!line.startsWith("#")) break;
    consumed++;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(1, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "separator") {
      header.separator = SEPARATOR_WORDS[value.toLowerCase()] ?? value;
    } else if (key === "deck") {
      header.deck = value;
    } else if (key === "tags column") {
      const n = Number(value);
      if (!Number.isNaN(n)) header.tagsColumn = n;
    } else if (key === "deck column") {
      const n = Number(value);
      if (!Number.isNaN(n)) header.deckColumn = n;
    } else if (key === "html") {
      header.html = value.toLowerCase() === "true";
    }
  }

  return { header, body: lines.slice(consumed).join("\n") };
}

/**
 * Convert Anki's field HTML into plain text.
 *
 * Anki stores fields as HTML, so a card typed with line breaks or bold
 * comes out as markup that would otherwise be shown literally to the user.
 * Block-level tags become newlines; everything else is dropped and the
 * standard entities are decoded.
 */
export function stripHtml(input: string): string {
  if (!input.includes("<") && !input.includes("&")) return input;

  let out = input
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "• ")
    .replace(/<[^>]*>/g, "");

  out = out
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  return out
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Rewrite Anki's numbered cloze markers into this app's single form.
 *
 * Anki groups deletions by number ({{c1::x}} and {{c2::y}} become two
 * separate cards); this app hides every marked word on one card, so the
 * numbering is dropped. Anki's optional "::hint" suffix is dropped too,
 * since there's nowhere to show a hint yet.
 */
export function convertAnkiCloze(input: string): string {
  return input.replace(/\{\{c(\d+)::(.*?)\}\}/g, (_full, _n, content: string) => {
    const withoutHint = content.split("::")[0] ?? content;
    return `{{c::${withoutHint}}}`;
  });
}
