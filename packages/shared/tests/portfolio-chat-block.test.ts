import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ChatBlockSchema } from "../src/schemas/chat-block.ts";

/**
 * 072 — the SHARED portfolio contract fixtures. The same JSON files are asserted against the
 * Python `PortfolioOverviewBlock.to_wire()` in
 * `services/agent/tests/portfolio/test_chat_block_fixtures.py`, so the two implementations cannot
 * drift.
 */
function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/portfolio/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

function parse(name: string) {
  const parsed = ChatBlockSchema.safeParse(fixture(name));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success) throw new Error("unreachable");
  return parsed.data;
}

test("ready fixture validates with all five sections and totals", () => {
  const block = parse("portfolio-overview-ready.json");
  assert.equal(block.type, "portfolio_overview");
  if (block.type !== "portfolio_overview") return;
  assert.equal(block.state, "ready");
  assert.equal(block.focus, "all");
  assert.deepEqual(
    block.sections.map((section) => section.key),
    ["balances", "morpho", "kamino", "rhea", "swaps"],
  );
  assert.equal(block.totals.totalUsd, "2300.00");
  assert.equal(block.totals.priced, true);
  assert.deepEqual(block.totals.byChain.map((row) => row.chain), ["base", "near"]);
  assert.deepEqual(
    block.sources,
    ["rpc", "morpho_api", "solana_rpc", "rhea_rpc", "db"],
  );

  const balances = block.sections[0];
  assert.equal(balances?.totalUsd, "2100.00");
  assert.equal(balances?.rows.length, 2);
  assert.equal(balances?.rows[0]?.kind, "native");
  assert.equal(balances?.rows[0]?.priceUsd, "4000");
  assert.equal(balances?.chains?.[1]?.status, "unavailable");
  assert.equal(balances?.chains?.[1]?.reason, "not configured");

  const morpho = block.sections[1];
  assert.equal(morpho?.rows[0]?.vaultName, "Gauntlet USDC Prime");
  assert.equal(morpho?.rows[0]?.netApy, "4.41");
  assert.equal(morpho?.rows[0]?.rail, "direct");

  const kamino = block.sections[2];
  assert.equal(kamino?.rows[0]?.sharesMint, "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK");
  assert.equal(kamino?.rows[0]?.valueUsd, undefined);
  assert.equal(kamino?.rows[0]?.priceSource, "kamino_share_price_unavailable");

  const rhea = block.sections[3];
  assert.equal(rhea?.mca, "eval.multica.near");
  assert.equal(rhea?.appUrl, "https://app.rhea.finance/lending");
  assert.equal(rhea?.rows[0]?.apy, "14.05");

  const swaps = block.sections[4];
  assert.equal(swaps?.rows[0]?.route, "Base USDC -> Solana USDC");
  assert.equal(swaps?.rows[0]?.lastStatus, "SUCCESS");
  assert.equal(swaps?.rows[0]?.amountOut, "0.98");
});

test("degraded fixture keeps each section's own status and reason", () => {
  const block = parse("portfolio-overview-degraded.json");
  if (block.type !== "portfolio_overview") return;
  assert.equal(block.state, "ready");
  const byKey = Object.fromEntries(block.sections.map((s) => [s.key, s]));
  assert.equal(byKey.balances?.status, "ok");
  assert.equal(byKey.morpho?.status, "unavailable");
  assert.equal(byKey.morpho?.reason, "Morpho API is unreachable.");
  assert.equal(byKey.kamino?.status, "not_linked");
  assert.match(byKey.kamino?.reason ?? "", /a Solana address is linked to your account/);
  assert.equal(byKey.rhea?.status, "unavailable");
  assert.equal(byKey.swaps?.status, "ok");
  assert.equal(byKey.swaps?.rows.length, 0);
  assert.equal(block.totals.totalUsd, "250.00");
});

test("empty fixture is an honest empty read with an unpriced total", () => {
  const block = parse("portfolio-overview-empty.json");
  if (block.type !== "portfolio_overview") return;
  assert.equal(block.state, "empty");
  assert.equal(block.totals.totalUsd, null);
  assert.equal(block.totals.priced, false);
  assert.deepEqual(block.totals.byChain, []);
  assert.deepEqual(block.totals.byProtocol, []);
  assert.equal(block.sections.every((section) => section.rows.length === 0), true);
});

test("the real empty-Rhea wire (explainer + linked addresses) validates", () => {
  const block = parse("portfolio-overview-empty-rhea-explainer.json");
  assert.equal(block.type, "portfolio_overview");
  if (block.type !== "portfolio_overview") return;
  assert.equal(block.state, "empty");
  const rhea = block.sections.find((section) => section.key === "rhea");
  assert.match(rhea?.explainer ?? "", /first deposit creates one/);
  assert.equal(rhea?.appUrl, "https://app.rhea.finance/lending");

  const withLinked = {
    ...(fixture("portfolio-overview-empty-rhea-explainer.json") as Record<string, unknown>),
    sections: [
      {
        key: "kamino",
        label: "Kamino",
        status: "ok",
        rows: [],
        linkedAddresses: 1,
      },
    ],
  };
  const parsed = ChatBlockSchema.safeParse(withLinked);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("portfolio_overview is strict: unknown fields and bad enums are rejected", () => {
  const ready = fixture("portfolio-overview-ready.json") as Record<string, unknown>;
  assert.equal(ChatBlockSchema.safeParse({ ...ready, unexpected: true }).success, false);
  assert.equal(ChatBlockSchema.safeParse({ ...ready, state: "partial" }).success, false);
  assert.equal(ChatBlockSchema.safeParse({ ...ready, focus: "everything" }).success, false);

  const section = (ready.sections as Record<string, unknown>[])[0] as Record<string, unknown>;
  assert.equal(
    ChatBlockSchema.safeParse({
      ...ready,
      sections: [{ ...section, status: "broken" }],
    }).success,
    false,
  );

  const row = (section.rows as Record<string, unknown>[])[0] as Record<string, unknown>;
  assert.equal(
    ChatBlockSchema.safeParse({
      ...ready,
      sections: [{ ...section, rows: [{ ...row, valueUsd: 2000 }] }],
    }).success,
    false,
    "valueUsd must be a decimal string, never a float",
  );
});

test("the API response shape (wallet + text) validates with the same schema", () => {
  const ready = fixture("portfolio-overview-ready.json") as Record<string, unknown>;
  const parsed = ChatBlockSchema.safeParse({
    ...ready,
    wallet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    text: "Your priced positions total about $2300.00. Read-only — nothing was signed or sent.",
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("1112 — an absent optional row field validates, but a literal null does not", () => {
  // The agent OMITS an unavailable APY/status instead of emitting `null`. This pins why: the
  // strict schema treats these as optional strings, and a null would invalidate the whole block.
  const ready = fixture("portfolio-overview-ready.json") as Record<string, unknown>;
  const sections = ready.sections as Record<string, unknown>[];
  const morpho = sections[1] as Record<string, unknown>;
  const morphoRows = morpho.rows as Record<string, unknown>[];
  const withoutApy = { ...morphoRows[0] };
  delete withoutApy.netApy;

  const absent = ChatBlockSchema.safeParse({
    ...ready,
    sections: [sections[0], { ...morpho, rows: [withoutApy] }, ...sections.slice(2)],
  });
  assert.equal(absent.success, true, JSON.stringify(absent.error?.issues));

  const asNull = ChatBlockSchema.safeParse({
    ...ready,
    sections: [sections[0], { ...morpho, rows: [{ ...morphoRows[0], netApy: null }] }, ...sections.slice(2)],
  });
  assert.equal(asNull.success, false, "null must be omitted, never serialized");
});
