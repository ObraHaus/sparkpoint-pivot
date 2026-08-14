/**
 * The live copy audit, hardened into CI (feature 044).
 *
 * The Playwright audit in `e2e/pw/visual-audit.spec.ts` renders the deployed app and is the real
 * check — but it needs a deployment, a session and a browser, so it does not run on a pull request.
 * Everything it caught therefore shipped first and was found afterwards.
 *
 * This closes the specific hole. It strips markup from the audited sources and matches the retired
 * phrases against the resulting text, so a phrase split across elements — the cause of BOTH copy
 * bugs that reached production — is found before merge rather than after deploy.
 *
 * ⚠️ **This is an approximation, and the difference matters.** It cannot see copy that arrives from
 * an API, copy assembled at runtime from variables, or anything about layout. It is a fast lower
 * bound, not a replacement for rendering the deployed page. Both are kept.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { appliesTo, AUDITED_SOURCES, RETIRED_PHRASES, visibleText } from "./retiredPhrases.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

function read(rel: string): string | undefined {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch {
    return undefined;
  }
}

test("every audited surface still exists", () => {
  // A renamed page silently drops out of the audit otherwise, and the suite stays green while the
  // surface it was protecting goes unchecked.
  for (const rel of AUDITED_SOURCES) {
    assert.ok(read(rel) !== undefined, `${rel} is audited but missing — update AUDITED_SOURCES`);
  }
});

test("no audited surface carries retired copy, including across element boundaries", () => {
  const failures: string[] = [];
  for (const rel of AUDITED_SOURCES) {
    const source = read(rel);
    if (source === undefined) continue;
    const text = visibleText(source);
    for (const phrase of RETIRED_PHRASES) {
      if (!appliesTo(phrase, rel)) continue;
      const hit = text.match(phrase.pattern);
      if (hit) failures.push(`${rel}: "${hit[0]}" — ${phrase.why}`);
    }
  }
  assert.deepEqual(failures, [], `retired copy is still user-visible:\n  ${failures.join("\n  ")}`);
});

test("the stripper actually joins text across elements", () => {
  // The regression that shipped: the sweep looked for "per month"; the markup said "/mo" in its own
  // span. Raw source does not contain the visible string, the stripped text does.
  const markup = `<div className="flex"><span>10,000 SRK</span><span className="x">/mo</span></div>`;
  assert.doesNotMatch(markup, /SRK\s*\/\s*mo/i, "precondition: raw source hides it");
  assert.match(visibleText(markup), /SRK\s*\/\s*mo/i, "stripped text must reveal it");
});

test("the stripper ignores comments, so a rule's own docs cannot trip it", () => {
  const src = `/* We used to say "cancel anytime" here. */\n<p>Nothing renews.</p>`;
  assert.doesNotMatch(visibleText(src), /cancel anytime/i);
});

test("the stripper ignores imports and attributes, not prose", () => {
  const src = `import x from "./per-month-helper.ts";\n<a href="/premium/per-month">Activate</a>`;
  const text = visibleText(src);
  assert.doesNotMatch(text, /per month/i);
  assert.match(text, /Activate/);
});

test("a scoped rule still fires inside its scope", () => {
  // Scoping must narrow WHERE a rule applies, never quietly disable it.
  const apyRule = RETIRED_PHRASES.find((p) => p.pattern.source.includes("APY"));
  assert.ok(apyRule, "the APY rule must exist");
  assert.ok(appliesTo(apyRule, "src/app/(app)/brokers/revenue/page.tsx"), "fires on a broker page");
  assert.ok(!appliesTo(apyRule, "src/app/(app)/fees/page.tsx"), "and not on the vault's fee page");
});

test("every retired phrase carries a reason", () => {
  // A bare regex list rots: without a reason, nobody can tell a real regression from a rule that
  // has outlived the product, and the safe-looking move is to delete the rule.
  for (const { pattern, why } of RETIRED_PHRASES) {
    assert.ok(why.length > 10, `${pattern} needs a reason explaining what it protects`);
  }
});

test("the audit is not vacuous — a planted phrase is caught", () => {
  // A guard that cannot fail is not a guard. This proves the matcher would bite on real markup.
  const planted = `<div><span>Premium</span> <span>10,000 SRK</span><span>/mo</span></div>`;
  const text = visibleText(planted);
  const caught = RETIRED_PHRASES.some((p) => p.pattern.test(text));
  assert.ok(caught, "a known-bad string must trip at least one retired phrase");
});
