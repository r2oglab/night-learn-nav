/**
 * Lightweight markdown for card text — **negrito**, *itálico*, `código`.
 * Not real HTML storage: pergunta/resposta stay plain text with markdown
 * syntax in them, rendered on demand wherever they're displayed. Cheaper
 * and safer than a WYSIWYG editor storing real HTML — nothing here can
 * inject markup the person didn't type, because the source is escaped
 * BEFORE any tag is introduced, so even literal `<`/`>` in a card's text
 * (an HTML example, a "less than" in a lab value) can never become a
 * live tag.
 *
 * Deliberately doesn't cover underline or color — no standard markdown
 * syntax for either, and bold/italic/code cover the actual use case
 * (chemical formulas, gene names, drug classes) without inventing a
 * custom syntax to learn.
 */
export function renderLiteMarkdown(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Inline style, not a Tailwind class: this HTML is injected via
  // dangerouslySetInnerHTML from a plain .ts file, not JSX, so there's no
  // guarantee Tailwind's content-scanner picks up a class name written as
  // a string here. Inline CSS sidesteps that risk entirely. <strong>/<em>
  // don't need this — their default browser styling (bold/italic) is
  // strong enough on its own to be unmistakable.
  const CODE_STYLE =
    "font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(128,128,128,0.2); padding: 0.1em 0.4em; border-radius: 0.3em; font-size: 0.875em;";

  // Order matters: bold's ** pairs are consumed first, so the italic
  // pass (single *) never mistakes a bold marker's stars for its own.
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`(.+?)`/g, `<code style="${CODE_STYLE}">$1</code>`)
    .replace(/\n/g, "<br />");
}