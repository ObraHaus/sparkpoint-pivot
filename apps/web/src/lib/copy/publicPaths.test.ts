/**
 * The published allocations must be reachable **without a session, under either gate** (044).
 *
 * ⚠️ This test exists because the real thing shipped broken and looked fine from inside the app.
 * `middleware.ts` has TWO independent gates:
 *
 *   * Gate 1 — the construction lock, consulted only when `SITE_LOCKED`. Uses `ALLOW_PREFIX`.
 *   * Gate 2 — the access gate, which is what develop actually runs. Uses `INFRA_PREFIX`.
 *
 * `/allocations/` was added to Gate 1 alone. The file was written, committed, deployed and served
 * — and every anonymous fetch still got a 307, because develop is unlocked and never consults that
 * list. Nothing failed; the artifact was simply invisible to anyone not signed in, which defeats
 * the entire reason for publishing it (FR-010: anyone must be able to recompute a period's split).
 *
 * A holder cannot claim without the proof in that document, and an auditor cannot check the split
 * without its inputs. So this asserts the path is in BOTH lists, by reading the middleware source
 * — a unit test of the app cannot see a redirect that happens above it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SOURCE = readFileSync(join(import.meta.dirname, "..", "..", "..", "middleware.ts"), "utf8");

/** Extract a `const NAME = [ ... ]` array literal's string entries. */
function entriesOf(name: string): string[] {
  const start = SOURCE.indexOf(`const ${name}`);
  assert.ok(start >= 0, `${name} not found in middleware.ts — did it get renamed?`);
  const open = SOURCE.indexOf("[", start);
  const close = SOURCE.indexOf("]", open);
  assert.ok(open >= 0 && close > open, `${name} is not an array literal`);
  return [...SOURCE.slice(open, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

test("the published allocations are public under the LOCKED gate", () => {
  assert.ok(
    entriesOf("ALLOW_PREFIX").includes("/allocations/"),
    "a locked deploy would 307 the allocation document to /coming-soon",
  );
});

test("the published allocations are public under the ACCESS gate (what develop runs)", () => {
  // The half that was missed. Gate 1 passing means nothing here.
  assert.ok(
    entriesOf("INFRA_PREFIX").includes("/allocations/"),
    "an unlocked deploy would 307 every anonymous fetch to /connect — the artifact is then " +
      "readable only by signed-in users, which is not a public record",
  );
});

test("both gates agree, so the artifact cannot be public in only one deploy shape", () => {
  const locked = entriesOf("ALLOW_PREFIX").includes("/allocations/");
  const unlocked = entriesOf("INFRA_PREFIX").includes("/allocations/");
  assert.equal(
    locked,
    unlocked,
    "whether the allocation document is fetchable must not depend on SITE_LOCKED",
  );
});
