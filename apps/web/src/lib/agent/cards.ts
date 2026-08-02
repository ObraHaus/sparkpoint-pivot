/**
 * Fail-closed ChatBlock card parsing (T027).
 *
 * Grounds the Frontend ↔ Orchestrator card seam in agent-service-api.md §2.7:
 * every streamed SSE block string is JSON-parsed then validated against the
 * `.strict()` discriminated union `ChatBlockSchema` (the single source of truth
 * in `@sparkpoint/shared/schemas`). On ANY failure — bad JSON, schema mismatch,
 * unknown/malformed type — this returns an INERT card the renderer shows as a
 * non-actionable notice. It NEVER throws into the render path and NEVER passes an
 * unvalidated block through.
 *
 * Signability (§2.7) is a pure, DISPLAY-ONLY helper: a recommendation/action
 * block is signable iff `policy.status === "approved"`. The chain re-checks at
 * sign time — this flag only gates whether the UI offers a sign affordance and
 * must never itself gate the withdraw/exit path.
 */

import { ChatBlockSchema, type ChatBlock } from "@sparkpoint/shared/schemas";

/** Why a raw block string could not be turned into a validated ChatBlock. */
export type InertReason = "invalid_json" | "schema_mismatch";

/**
 * The renderer-facing result of parsing one SSE block string.
 * - `valid`: a schema-validated ChatBlock plus its display-only `signable` flag.
 * - `inert`: fail-closed fallback — render as a non-actionable notice, never
 *   signable. `raw` is retained for logging/debugging, not for rendering as-is.
 */
export type ChatCard =
  | { status: "valid"; block: ChatBlock; signable: boolean }
  | { status: "inert"; reason: InertReason; message: string; raw: string };

/** Copy shown for an inert card — deliberately non-actionable. */
const INERT_MESSAGE =
  "This response couldn't be verified and can't be acted on.";

/**
 * §2.7 signability — PURE and DISPLAY-ONLY. A `recommendation`/`action` block is
 * signable ONLY when its policy stamp is `approved`; every other block type is
 * non-signable. The deterministic on-chain policy is the authority; this is a
 * mirror the UI uses to decide whether to render a sign affordance. It must
 * never gate signing off client state (non-custody law).
 */
export function isSignable(block: ChatBlock): boolean {
  return (
    (block.type === "recommendation" || block.type === "action") &&
    block.policy.status === "approved"
  );
}

/**
 * Parse ONE SSE block string into a `ChatCard`, fail-closed. Never throws:
 * `JSON.parse` is guarded and validation uses `safeParse`, so a malformed or
 * unknown block degrades to an inert, non-actionable card instead of crashing
 * the stream or leaking an unvalidated block to the renderer.
 */
export function parseCard(raw: string): ChatCard {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { status: "inert", reason: "invalid_json", message: INERT_MESSAGE, raw };
  }
  return parseCardValue(json, raw);
}

/**
 * Parse ONE already-decoded block VALUE into a `ChatCard`, fail-closed — the
 * REPLAY entry point (feature 025). A conversation reopened from
 * `GET /conversations/{id}` carries its persisted blocks as parsed JSON, not as
 * SSE strings, so there is nothing to `JSON.parse`.
 *
 * A replayed block gets EXACTLY the validation a streamed one does — the same
 * `.strict()` union, the same `isSignable` derivation from the persisted policy
 * stamp. So a schema drift, a truncated row, or a hand-edited DB value degrades
 * to the same inert, non-actionable card, and a stored block can never confer a
 * sign path its stamp does not carry. (`raw` is only for logging; it is
 * reconstructed from the value when the caller has no original string.)
 */
export function parseCardValue(value: unknown, raw?: string): ChatCard {
  const result = ChatBlockSchema.safeParse(value);
  if (!result.success) {
    return {
      status: "inert",
      reason: "schema_mismatch",
      message: INERT_MESSAGE,
      raw: raw ?? safeStringify(value),
    };
  }

  const block = result.data;
  return { status: "valid", block, signable: isSignable(block) };
}

/** `JSON.stringify` that can never throw into the render path (cyclic/BigInt input). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable block]";
  }
}
