import assert from "node:assert/strict";
import { test } from "node:test";
import {
  brokerView,
  brokerViews,
  COLLECTION_SIZE,
  deriveActivateState,
  deriveMintState,
  formatSrk,
  premiumSourceView,
  RETIRED_VERB,
  SUBSCRIPTIONS_RETIRED,
  wholeSrk,
} from "./brokers.ts";

const ORIGIN = "https://brokers-dev.aldrickb.app";
const SALE = "0x488268134af3d01E0672A9Ea17d529D4C5E275Dd";
const REGISTRY = "0xD95067667E5ff2B1e898AF83063e8D2ca7D8D775";
const PRICE = 10_000n * 10n ** 18n;

// ── the gallery ─────────────────────────────────────────────────────────────────────────────

test("an activated broker points at the gold-framed image, an idle one does not", () => {
  const active = brokerView({ id: 4, activatedAt: 11_481_694n }, ORIGIN);
  assert.equal(active.activated, true);
  assert.equal(active.imagePath, `${ORIGIN}/i/4-a.png`);
  assert.equal(active.statusLabel, "Active");

  const idle = brokerView({ id: 4, activatedAt: 0n }, ORIGIN);
  assert.equal(idle.activated, false);
  assert.equal(idle.imagePath, `${ORIGIN}/i/4.png`);
  assert.equal(idle.statusLabel, "Idle");
});

test("activatedAt is a BLOCK NUMBER — any non-zero value means activated", () => {
  // Not a timestamp, and on Robinhood Chain not resolvable to a date either. All that matters here
  // is zero vs non-zero.
  assert.equal(brokerView({ id: 1, activatedAt: 1n }, ORIGIN).activated, true);
  assert.equal(brokerView({ id: 1, activatedAt: 99_999_999n }, ORIGIN).activated, true);
  assert.equal(brokerView({ id: 1, activatedAt: 0n }, ORIGIN).activated, false);
});

test("ids are zero-padded for display but never for the image path", () => {
  const v = brokerView({ id: 7, activatedAt: 0n }, ORIGIN);
  assert.equal(v.label, "#0007");
  assert.equal(v.imagePath, `${ORIGIN}/i/7.png`, "the service serves unpadded ids");
});

test("a trailing slash on the origin never produces a doubled slash", () => {
  assert.equal(
    brokerView({ id: 3, activatedAt: 0n }, "https://brokers-dev.aldrickb.app/").imagePath,
    `${ORIGIN}/i/3.png`,
  );
});

test("a gallery maps every token and keeps their order", () => {
  const views = brokerViews(
    [
      { id: 4, activatedAt: 11_481_694n },
      { id: 5, activatedAt: 0n },
    ],
    ORIGIN,
  );
  assert.deepEqual(
    views.map((v) => [v.id, v.activated]),
    [
      [4, true],
      [5, false],
    ],
  );
});

// ── mint ────────────────────────────────────────────────────────────────────────────────────

const mintBase = {
  sale: SALE,
  open: true,
  mintedByWallet: 0n,
  perWalletCap: 5n,
  totalMinted: 8n,
  maxSupply: BigInt(COLLECTION_SIZE),
  walletReady: true,
};

test("an open sale with headroom is mintable", () => {
  const s = deriveMintState(mintBase);
  assert.equal(s.canMint, true);
  assert.equal(s.blockedReason, undefined);
  assert.equal(s.remaining, 5);
  assert.equal(s.mintedSoFar, 8);
  assert.equal(s.supply, COLLECTION_SIZE);
});

test("no sale on this chain ⇒ unavailable, never a button that cannot work", () => {
  const s = deriveMintState({ ...mintBase, sale: undefined });
  assert.equal(s.configured, false);
  assert.equal(s.canMint, false);
  assert.match(s.blockedReason ?? "", /isn’t available/);
});

test("reads not back yet ⇒ not loaded, not mintable, and no fabricated counts", () => {
  const s = deriveMintState({ ...mintBase, perWalletCap: undefined, totalMinted: undefined });
  assert.equal(s.loaded, false);
  assert.equal(s.canMint, false);
  assert.equal(s.mintedSoFar, undefined, "an unread count must not render as 0");
  assert.match(s.blockedReason ?? "", /Reading the sale/);
});

test("a closed sale blocks minting and says so", () => {
  const s = deriveMintState({ ...mintBase, open: false });
  assert.equal(s.canMint, false);
  assert.match(s.blockedReason ?? "", /closed/);
});

test("the per-wallet cap blocks at exactly the cap, not one before", () => {
  assert.equal(deriveMintState({ ...mintBase, mintedByWallet: 4n }).canMint, true);
  assert.equal(deriveMintState({ ...mintBase, mintedByWallet: 4n }).remaining, 1);

  const capped = deriveMintState({ ...mintBase, mintedByWallet: 5n });
  assert.equal(capped.canMint, false);
  assert.equal(capped.remaining, 0);
  assert.match(capped.blockedReason ?? "", /all the brokers this wallet can/);
});

test("a sold-out collection is reported as sold out, not as a wallet problem", () => {
  const s = deriveMintState({ ...mintBase, totalMinted: BigInt(COLLECTION_SIZE) });
  assert.equal(s.canMint, false);
  assert.match(s.blockedReason ?? "", /Every broker has been minted/);
});

test("a disconnected wallet is the LAST reason given, after the real blockers", () => {
  // Telling someone to connect a wallet when the sale is closed wastes their time.
  const closed = deriveMintState({ ...mintBase, open: false, walletReady: false });
  assert.match(closed.blockedReason ?? "", /closed/);
  const ok = deriveMintState({ ...mintBase, walletReady: false });
  assert.match(ok.blockedReason ?? "", /Connect your wallet/);
});

// ── activate ────────────────────────────────────────────────────────────────────────────────

const actBase = {
  registry: REGISTRY,
  price: PRICE,
  balance: PRICE,
  allowance: PRICE,
  ownsToken: true,
  alreadyActivated: false,
  walletReady: true,
};

test("owning an unactivated broker with enough SRK and allowance is activatable", () => {
  const s = deriveActivateState(actBase);
  assert.equal(s.canActivate, true);
  assert.equal(s.needsApproval, false);
  assert.equal(s.short, 0n);
});

test("the blockers mirror the contract's own checks, in the contract's order", () => {
  assert.match(
    deriveActivateState({ ...actBase, ownsToken: false }).blockedReason ?? "",
    /don’t hold this broker/,
  );
  assert.match(
    deriveActivateState({ ...actBase, alreadyActivated: true }).blockedReason ?? "",
    /already active/,
  );
  assert.match(
    deriveActivateState({ ...actBase, balance: PRICE - 1n }).blockedReason ?? "",
    /enough SRK/,
  );
});

test("an allowance below the price asks for approval rather than blocking", () => {
  // Not having approved yet is a step, not a failure — the UI offers the approve leg.
  const s = deriveActivateState({ ...actBase, allowance: 0n });
  assert.equal(s.needsApproval, true);
  assert.equal(s.canActivate, true, "approval is part of the flow, not a blocker");
});

test("the shortfall is exact, so the screen can say how much more is needed", () => {
  const s = deriveActivateState({ ...actBase, balance: 2_500n * 10n ** 18n });
  assert.equal(s.short, 7_500n * 10n ** 18n);
  assert.equal(formatSrk(s.short), "7,500 SRK");
});

test("reads not back yet ⇒ not activatable and no fabricated shortfall", () => {
  const s = deriveActivateState({ ...actBase, price: undefined });
  assert.equal(s.loaded, false);
  assert.equal(s.canActivate, false);
  assert.equal(s.short, 0n);
  assert.match(s.blockedReason ?? "", /Reading the chain/);
});

// ── money formatting ────────────────────────────────────────────────────────────────────────

test("SRK amounts floor and never round a price down", () => {
  assert.equal(wholeSrk(PRICE), 10_000);
  assert.equal(wholeSrk(PRICE - 1n), 9_999);
  assert.equal(formatSrk(PRICE), "10,000 SRK");
  assert.equal(formatSrk(undefined), "…", "an unread price is never rendered as 0");
});

// ── the word, and naming the source ─────────────────────────────────────────────────────────

test("the verb is RETIRED — 'burned' would be a supply claim that is not true", () => {
  // The token has no burn function and the total supply is unchanged by an activation; there is a
  // contract fuzz test asserting exactly that.
  assert.equal(RETIRED_VERB, "retired");
});

test("a broker-sourced Premium names the broker and never shows an expiry date", () => {
  const v = premiumSourceView("broker", 4);
  assert.match(v.headline, /#0004/);
  assert.match(v.detail, /no expiry/);
  assert.match(v.endsWhen, /transfer/);
  assert.equal(v.showsExpiry, false, "it ends on transfer, not on a date — never fabricate one");
});

test("a subscription-sourced Premium keeps its expiry", () => {
  const v = premiumSourceView("stored");
  assert.equal(v.showsExpiry, true);
  assert.match(v.endsWhen, /expiry date/);
});

test("no source at all explains what would switch it on", () => {
  const v = premiumSourceView(null);
  assert.match(v.headline, /Not active/);
  assert.match(v.endsWhen, /Activate a Sparky Broker/);
  assert.equal(v.showsExpiry, false);
});

test("no copy this module produces ever says 'burn'", () => {
  const copy = [
    ...[null, "stored", "broker"].flatMap((s) => {
      const v = premiumSourceView(s as "broker" | "stored" | null, 4);
      return [v.headline, v.detail, v.endsWhen];
    }),
    deriveMintState({ ...mintBase, open: false }).blockedReason ?? "",
    deriveActivateState({ ...actBase, balance: 0n }).blockedReason ?? "",
  ].join(" ");
  assert.doesNotMatch(copy, /burn/i, "say retired: the supply does not change");
});

test("the retirement flag is ONE value, so the two Premium surfaces cannot contradict", () => {
  // The bug this prevents is small and embarrassing: /premium offering "buy a month" while
  // /premium/pay says the subscription is retired. Held in one page and copied to the other, that
  // is exactly what happened — hence a single exported constant both read.
  assert.equal(typeof SUBSCRIPTIONS_RETIRED, "boolean");
  assert.equal(SUBSCRIPTIONS_RETIRED, true, "043 phase F — the broker replaces the subscription");
});

// ── the copy audit, as a test ───────────────────────────────────────────────────────────────

test("no retired Premium framing survives in the copy this module owns", () => {
  // The operator asked for a sweep of every surface that still described Premium as a monthly
  // subscription. A grep proves the strings changed today; this keeps them changed.
  const copy = [
    ...([null, "stored", "broker"] as const).flatMap((s) => {
      const v = premiumSourceView(s, 4);
      return [v.headline, v.detail, v.endsWhen];
    }),
    deriveMintState({ ...mintBase, open: false }).blockedReason ?? "",
    deriveMintState({ ...mintBase, sale: undefined }).blockedReason ?? "",
    deriveActivateState({ ...actBase, balance: 0n }).blockedReason ?? "",
    deriveActivateState({ ...actBase, alreadyActivated: true }).blockedReason ?? "",
  ].join(" ");

  // Bans the SELLING framing, not the word "subscription" itself — describing a legacy source
  // accurately is exactly what these surfaces should do. What must not survive is any suggestion
  // that Premium can still be bought, renewed or extended.
  for (const retired of [
    /buy a month/i,
    /cancel anytime/i,
    /per month/i,
    /\brenew\b/i,
    /\bextend it\b/i,
    /comes from a subscription/i,
    /burn/i,
  ]) {
    assert.doesNotMatch(copy, retired, `retired Premium framing: ${retired}`);
  }
});

test("nothing here promises a revenue share, because none is built", () => {
  // The activation copy used to say "Premium, and a payout weight". Revenue sharing has been
  // DISCUSSED but not built, and a UI that promises it is making a commitment the product cannot
  // keep. If it ships later, this test is the thing to delete deliberately.
  const copy = ([null, "stored", "broker"] as const)
    .flatMap((s) => {
      const v = premiumSourceView(s, 4);
      return [v.headline, v.detail, v.endsWhen];
    })
    .join(" ");
  for (const promise of [/payout/i, /revenue/i, /weight/i, /dividend/i, /share of/i]) {
    assert.doesNotMatch(copy, promise, `unbuilt promise: ${promise}`);
  }
});
