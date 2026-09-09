/**
 * richText — the small amount of markdown a chat answer is actually allowed to use.
 *
 * WHY THIS EXISTS (029). The `text` block's field is called `markdown`, but the chat rendered it
 * as a raw string inside a plain `<div>`. Two things followed, both visible in the verification
 * run: `**0% on deposits, withdrawals and your principal**` displayed with its asterisks intact,
 * and every blank line collapsed, so a three-paragraph answer arrived as one unbroken wall of
 * text. The advice boundary and the automation answer are both multi-paragraph by design — they
 * were the worst-looking replies on screen despite being the most carefully written.
 *
 * Deliberately tiny: paragraphs and bold. No links, no HTML, no `dangerouslySetInnerHTML` — the
 * output is a data structure the component maps to elements, so model-authored text cannot inject
 * markup no matter what it contains.
 *
 * Leaf module: no imports, no React, so `node --test` loads it directly.
 */

/** One run of text within a paragraph. */
export interface Segment {
  readonly text: string;
  readonly bold: boolean;
}

/** A paragraph is a list of segments; a document is a list of paragraphs. */
export type Paragraph = readonly Segment[];

const BOLD = /\*\*([^*]+)\*\*/g;

/** Split one paragraph's text into bold / plain runs. */
function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(BOLD)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), bold: false });
    out.push({ text: m[1], bold: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length > 0 ? out : [{ text, bold: false }];
}

/**
 * Parse an answer into paragraphs of styled runs.
 *
 * A blank line starts a new paragraph; a single newline is treated as a space, which is how the
 * agent's prose is written. An unmatched `**` is left alone rather than swallowing the rest of the
 * answer — a stray asterisk is a blemish, a vanished paragraph is a lie.
 */
export function parseRichText(markdown: string | null | undefined): Paragraph[] {
  const text = (markdown ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((para) => para.split("\n").join(" ").trim())
    .filter(Boolean)
    .map(segments);
}

/** The answer with its formatting removed — for previews, summaries, and tests. */
export function plainText(markdown: string | null | undefined): string {
  return parseRichText(markdown)
    .map((p) => p.map((s) => s.text).join(""))
    .join("\n\n");
}
