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

/**
 * 045 — the public alpha application, same trap, different shape.
 *
 * The form is rendered by the LANDING PAGE, and the landing page is served on a locked deploy (`/`
 * is in ALLOW_EXACT). So the endpoint it posts to has to be served there too. Gate 1 has no `/api`
 * prefix entry by design — only exact matches survive it — which is precisely how a form could ship
 * looking perfectly fine on develop and 307 every submission to /coming-soon in the other
 * deployment, where the client would read the redirected HTML as a failure.
 */
test("the public application endpoint is reachable under the LOCKED gate", () => {
  assert.ok(
    entriesOf("ALLOW_EXACT").includes("/api/access/apply"),
    "a locked deploy renders the application form and 307s its submission — Gate 1 has no /api " +
      "prefix, so the exact path must be listed",
  );
});

test("the application page is public under BOTH gates", () => {
  assert.ok(
    entriesOf("ALLOW_EXACT").includes("/apply"),
    "a locked deploy would send /apply to /coming-soon",
  );
  assert.ok(
    entriesOf("PUBLIC_EXACT").includes("/apply"),
    "an unlocked deploy would 307 /apply to /connect — asking for access would require access",
  );
});

test("applying never requires a session under either gate", () => {
  // The one invariant that makes the feature work at all: the applicant has no wallet, no
  // signature and no cookie. Any gate that redirects them lands them on the wall they are writing
  // to ask about.
  const gate1 = entriesOf("ALLOW_EXACT");
  const gate2Pages = entriesOf("PUBLIC_EXACT");
  const gate2Api = entriesOf("INFRA_PREFIX");
  assert.ok(gate1.includes("/apply") && gate2Pages.includes("/apply"));
  assert.ok(
    gate1.includes("/api/access/apply") && gate2Api.some((p) => "/api/access/apply".startsWith(p)),
    "Gate 2 passes /api/* via INFRA_PREFIX; if that prefix is ever narrowed, this path needs its " +
      "own entry",
  );
});

test("the mint whitelist page is public under BOTH gates", () => {
  // The Sparky Broker whitelist form has the same applicant as /apply: no wallet, no session. It
  // shares the one submission endpoint (`/api/access/apply`, already asserted above), so only the
  // page itself needs listing here — in both gates, or it is public in one deploy shape only.
  assert.ok(
    entriesOf("ALLOW_EXACT").includes("/mint-whitelist"),
    "a locked deploy would send /mint-whitelist to /coming-soon",
  );
  assert.ok(
    entriesOf("PUBLIC_EXACT").includes("/mint-whitelist"),
    "an unlocked deploy would 307 /mint-whitelist to /connect — applying for a mint spot would " +
      "require being let in",
  );
});
