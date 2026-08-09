/**
 * Character-level comparison for "type in the answer" cards, mirroring how
 * Anki shows what you got right and wrong.
 *
 * Anki diffs the typed text against the expected answer and renders the
 * expected answer with each character marked as matched, wrong, or missing.
 * Reporting only "certo/errado" would lose the part that actually teaches:
 * seeing *where* the answer diverged.
 */

export type DiffPart = {
  text: string;
  /** ok = typed correctly · missing = expected but not typed · extra = typed but not expected */
  kind: "ok" | "missing" | "extra";
};

export type AnswerComparison = {
  correct: boolean;
  /** The expected answer, annotated with what the user got right. */
  expected: DiffPart[];
  /** What the user typed, annotated with what didn't belong. */
  typed: DiffPart[];
};

/**
 * Anki ignores case and surrounding whitespace when judging, so "paris" is
 * accepted for "Paris". Inner spacing is collapsed for the same reason.
 */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Longest common subsequence table over two character arrays. */
function lcsMatrix(a: string[], b: string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const prevDiag = table[i - 1]?.[j - 1] ?? 0;
      const up = table[i - 1]?.[j] ?? 0;
      const left = table[i]?.[j - 1] ?? 0;
      table[i]![j] = a[i - 1] === b[j - 1] ? prevDiag + 1 : Math.max(up, left);
    }
  }
  return table;
}

/** Merge neighbouring parts of the same kind so rendering isn't per-character. */
function coalesce(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last && last.kind === part.kind) last.text += part.text;
    else out.push({ ...part });
  }
  return out;
}

export function compareAnswer(typedRaw: string, expectedRaw: string): AnswerComparison {
  const typedNorm = normalize(typedRaw);
  const expectedNorm = normalize(expectedRaw);

  if (typedNorm === expectedNorm) {
    return {
      correct: true,
      expected: [{ text: expectedRaw.trim(), kind: "ok" }],
      typed: [{ text: typedRaw.trim(), kind: "ok" }],
    };
  }

  // Diff on the normalized forms so case/spacing don't create noise, but
  // render using the original expected text so accents and capitals show
  // as the user should learn them.
  const a = Array.from(expectedNorm);
  const b = Array.from(typedNorm);
  const table = lcsMatrix(a, b);

  const expectedParts: DiffPart[] = [];
  const typedParts: DiffPart[] = [];
  const expectedOriginal = Array.from(expectedRaw.trim().replace(/\s+/g, " "));
  const typedOriginal = Array.from(typedRaw.trim().replace(/\s+/g, " "));

  let i = a.length;
  let j = b.length;
  const expectedRev: DiffPart[] = [];
  const typedRev: DiffPart[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      expectedRev.push({ text: expectedOriginal[i - 1] ?? a[i - 1]!, kind: "ok" });
      typedRev.push({ text: typedOriginal[j - 1] ?? b[j - 1]!, kind: "ok" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (table[i]?.[j - 1] ?? 0) >= (table[i - 1]?.[j] ?? 0))) {
      typedRev.push({ text: typedOriginal[j - 1] ?? b[j - 1]!, kind: "extra" });
      j--;
    } else if (i > 0) {
      expectedRev.push({ text: expectedOriginal[i - 1] ?? a[i - 1]!, kind: "missing" });
      i--;
    }
  }

  expectedParts.push(...expectedRev.reverse());
  typedParts.push(...typedRev.reverse());

  return {
    correct: false,
    expected: coalesce(expectedParts),
    typed: coalesce(typedParts),
  };
}