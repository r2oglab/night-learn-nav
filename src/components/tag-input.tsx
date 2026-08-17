import { useState } from "react";
import { X } from "lucide-react";

/**
 * Chip-style tag input: type and press Enter or comma to add, click × or
 * Backspace-on-empty to remove. No autocomplete against existing tags in
 * v1 — that's a reasonable follow-up if typos start fragmenting tags, but
 * out of scope for a first pass.
 */
export function TagInput({
  tags,
  onChange,
  placeholder = "Adicionar tag e Enter",
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.trim();
    setDraft("");
    if (!value || tags.includes(value)) return;
    onChange([...tags, value]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border p-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
            <span className="sr-only">Remover tag {tag}</span>
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export default TagInput;