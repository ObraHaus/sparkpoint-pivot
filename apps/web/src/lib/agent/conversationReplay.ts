/**
 * conversationReplay — the pure wire→turn mapping for `GET /conversations/{id}` (§B1), extracted
 * from the chat page so it can be unit-tested without React (mirrors `outcomesView` / `recView`).
 *
 * WHY THIS EXISTS (feature 025). `conversation_turns` used to store `content TEXT` only, and the
 * agent lossy-summarized each streamed card on the way in — a swap card became the literal string
 * `"[proposed action: aerodrome_swap]"`, a recommendation became `"[recommended: …]"`, a portfolio
 * became `"[showed your portfolio]"`. The page replayed those as plain text, so a conversation
 * visibly fell apart the moment you reopened it. Migration 0028 added a `blocks` column; this
 * mapper decides, per turn, whether replay renders the real cards or the legacy text.
 *
 * Contract:
 *  - an assistant turn WITH usable blocks replays as cards (rehydrated by the caller through the
 *    same fail-closed `parseCard` validator and the same `LiveBlocks` renderer the live stream
 *    uses — identical components, identical signability rules);
 *  - an assistant turn WITHOUT blocks (every pre-025 row, and any turn whose blocks were dropped)
 *    replays as its text summary, exactly as before — legacy conversations are untouched;
 *  - `tool_step` blocks are dropped defensively. The writer already excludes them, but a row
 *    written by a future/other producer must never replay a frozen "running…" progress spinner.
 *
 * Fail-open and total: every field is parsed defensively and an unusable turn is dropped rather
 * than thrown on, so a corrupt row degrades that one turn instead of blanking the conversation.
 * NO `@/` imports and no value imports — this stays a leaf module so `node --test` can load it.
 */

/** One turn as it arrives on the §B1 wire (every field optional — defensive parsing). */
export interface ConversationTurnDto {
  role?: string;
  content?: string;
  /** §2.7 ChatBlock wire JSON for an assistant turn (025). Absent on every pre-025 row. */
  blocks?: unknown;
}

/**
 * One turn ready to render. `cards` carries the raw block VALUES — the caller validates each
 * through `parseCard`/`parseCardValue`, so this module never needs the zod schemas (and stays a
 * leaf). An unvalidated block value is never renderable on its own.
 */
export type ReplayTurn =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "cards"; cards: unknown[] };

/** Transient thinking-state — never replayed (see the module note). */
const TRANSIENT_BLOCK_TYPES = new Set(["tool_step"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The replayable block values of one turn: objects only, minus transient thinking-state. */
function replayableBlocks(blocks: unknown): unknown[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(
    (b) => isRecord(b) && !TRANSIENT_BLOCK_TYPES.has(String(b.type)),
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Map the persisted turns of a conversation into renderable replay turns.
 *
 * Empty turns are dropped (an assistant turn with neither cards nor text has nothing to show),
 * which preserves the page's previous `content.trim().length > 0` filter while letting a
 * cards-only turn through — that turn has an empty summary but is very much worth rendering.
 */
export function replayTurns(turns: readonly ConversationTurnDto[] | undefined | null): ReplayTurn[] {
  if (!Array.isArray(turns)) return [];
  const out: ReplayTurn[] = [];
  for (const turn of turns) {
    if (!isRecord(turn)) continue;
    const body = text(turn.content);
    if (turn.role === "user") {
      if (body) out.push({ kind: "user", text: body });
      continue;
    }
    // Anything not explicitly a user turn renders on the assistant side (the wire's CHECK
    // constraint only admits 'user' | 'assistant', so this is the assistant case).
    const cards = replayableBlocks(turn.blocks);
    if (cards.length > 0) {
      out.push({ kind: "cards", cards });
    } else if (body) {
      out.push({ kind: "text", text: body });
    }
  }
  return out;
}
