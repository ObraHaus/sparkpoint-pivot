import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Anti-rot guard for the Phase-3 descope register (feature 016). Docs-only, but pure `node:test`
 * so it rides the existing web strip-types test job (which globs the src test files).
 * The web test runs with cwd = apps/web, so the repo root is two levels up.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const REGISTER = path.join(ROOT, "docs/phase-3-deferred.md");

test("the Phase-3 register exists and covers all 8 deferred items", () => {
  assert.ok(existsSync(REGISTER), "docs/phase-3-deferred.md must exist");
  const txt = readFileSync(REGISTER, "utf8");
  for (const anchor of ["US6", "Sui", "Aerodrome", "Morpho", "Notifications", "TVL", "outcome", "US2"]) {
    assert.ok(txt.includes(anchor), `register must mention "${anchor}"`);
  }
  // 8 numbered detail sections (### 1. … ### 8.)
  for (let i = 1; i <= 8; i++) {
    assert.ok(new RegExp(`^### ${i}\\. `, "m").test(txt), `register must have detail section ${i}`);
  }
});

test("every repo path the register cites still exists (rename → doc update)", () => {
  const txt = readFileSync(REGISTER, "utf8");
  // repo-relative paths under a known top-level dir; strip a trailing :line and surrounding punctuation.
  const re = /\b(?:apps|services|packages|contracts|specs|docs|\.specify)\/[A-Za-z0-9_./()[\]-]+/g;
  const raw = txt.match(re) ?? [];
  // strip trailing sentence punctuation only — NOT ) or ], which are real dir chars ((app), [intent]).
  const paths = [...new Set(raw.map((p) => p.replace(/[.,;:`]+$/, "")))];
  assert.ok(paths.length > 5, "expected several cited paths");
  for (const rel of paths) {
    assert.ok(existsSync(path.join(ROOT, rel)), `register cites a missing path: ${rel}`);
  }
});

test("wave-state.json P3 entry lists the 8 deferred items and stays valid JSON", () => {
  const ws = JSON.parse(readFileSync(path.join(ROOT, "docs/orchestration/wave-state.json"), "utf8")) as {
    waves?: Array<{ id?: string; deferred_register?: string; deferred_items?: unknown[] }>;
  };
  const p3 = (ws.waves ?? []).find((w) => w.id === "P3");
  assert.ok(p3, "wave-state must have a P3 wave");
  assert.equal(p3.deferred_register, "docs/phase-3-deferred.md");
  assert.equal(Array.isArray(p3.deferred_items) && p3.deferred_items.length, 8);
});
