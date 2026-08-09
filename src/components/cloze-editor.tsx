import { useMemo } from "react";

import { Input } from "@/components/ui/input";

export const CLOZE_PATTERN = /\{\{c::(.*?)\}\}/;
export const CLOZE_PATTERN_G = /\{\{c::(.*?)\}\}/g;

export function isClozeText(text: string): boolean {
  return CLOZE_PATTERN.test(text);
}

/** "A capital é {{c::Paris}}" -> "A capital é ___" */
export function maskCloze(text: string): string {
  return text.replace(CLOZE_PATTERN_G, "___");
}

/** "A capital é {{c::Paris}}" -> "A capital é Paris" */
export function revealCloze(text: string): string {
  return text.replace(CLOZE_PATTERN_G, (_m, g: string) => g);
}

/**
 * Split stored cloze text back into the plain sentence plus the set of word
 * indices that were hidden, so an existing card can be reopened in the same
 * click-the-words editor it was created with instead of exposing raw
 * {{c::}} syntax the user can silently break.
 */
export function parseClozeText(stored: string): { text: string; hidden: Set<number> } {
  const plain = revealCloze(stored);
  const plainTokens = plain.split(/(\s+)/);
  const hidden = new Set<number>();

  // Walk the stored string and the plain one in parallel, marking every
  // plain token whose characters came from inside a {{c::}} marker.
  const hiddenCharRanges: [number, number][] = [];
  let plainPos = 0;
  let i = 0;
  while (i < stored.length) {
    const rest = stored.slice(i);
    const match = /^\{\{c::(.*?)\}\}/.exec(rest);
    if (match) {
      const content = match[1] ?? "";
      hiddenCharRanges.push([plainPos, plainPos + content.length]);
      plainPos += content.length;
      i += match[0].length;
    } else {
      plainPos += 1;
      i += 1;
    }
  }

  let cursor = 0;
  plainTokens.forEach((tok, idx) => {
    const start = cursor;
    const end = cursor + tok.length;
    cursor = end;
    if (tok.trim() === "") return;
    const overlaps = hiddenCharRanges.some(([s, e]) => start < e && end > s);
    if (overlaps) hidden.add(idx);
  });

  return { text: plain, hidden };
}

/** Rebuild the stored form from the sentence plus the hidden indices. */
export function buildClozeText(text: string, hidden: Set<number>): string {
  return text
    .split(/(\s+)/)
    .map((tok, i) => (hidden.has(i) ? `{{c::${tok}}}` : tok))
    .join("");
}

export function ClozeEditor({
  text,
  hidden,
  onTextChange,
  onToggleToken,
  label = "Frase",
  placeholder = "Ex: A capital da França é Paris",
}: {
  text: string;
  hidden: Set<number>;
  onTextChange: (value: string) => void;
  onToggleToken: (index: number) => void;
  label?: string;
  placeholder?: string;
}) {
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);
  const hasHidden = hidden.size > 0;

  return (
    <div className="grid gap-2">
      <label className="flex flex-col gap-2 text-sm text-muted-foreground">
        {label}
        <Input
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={placeholder}
        />
      </label>

      {text.trim() !== "" && (
        <>
          <p className="text-xs text-muted-foreground">
            Clique ou toque nas palavras que quer esconder:
          </p>
          <p className="rounded-md border border-border p-3 text-sm leading-relaxed">
            {tokens.map((tok, i) =>
              tok.trim() === "" ? (
                <span key={i}>{tok}</span>
              ) : (
                <span
                  key={i}
                  onClick={() => onToggleToken(i)}
                  className={
                    hidden.has(i)
                      ? "cursor-pointer rounded bg-primary px-0.5 text-primary-foreground"
                      : "cursor-pointer rounded px-0.5 hover:bg-muted"
                  }
                >
                  {tok}
                </span>
              ),
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Pré-visualização:{" "}
            <span className="text-foreground">
              {hasHidden
                ? tokens.map((tok, i) => (hidden.has(i) ? "___" : tok)).join("")
                : "(nenhuma palavra marcada ainda)"}
            </span>
          </p>
        </>
      )}
    </div>
  );
}

export default ClozeEditor;