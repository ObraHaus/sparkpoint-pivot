# Quickstart: Premium Purchase via SRK

How to deploy the test SRK, run the feature, and verify it locally + on the dev/staging (alpha) environment.

## Prerequisites

- Node 20 (`.nvmrc`), **pnpm 9 (NOT 11 — see the pnpm-version trap)** for any web dep change.
- Python 3.12 + `uv` for `services/agent`.
- Foundry (`forge`) with the vendored libs under `contracts/lib/` (OpenZeppelin v5.1.0), `solc 0.8.24`.
- A Base Sepolia (84532) RPC URL + a funded deployer key for the SRK deploy.
- Postgres reachable (dev: the develop DB via the LAN IP + published port — see `MIGRATIONS.md`/`COOLIFY.md`; internal container URLs do NOT resolve across Coolify resources).
- `pnpm install --frozen-lockfile` at the repo root.

## Deploy the SRK token (Base Sepolia only)

```bash
cd contracts
forge test --match-path 'test/token/SparkPointTestToken.t.sol'   # unit + FUZZ must pass first (Principle IV)
forge script script/DeploySRK.s.sol:DeploySRK \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_KEY" --broadcast
```

`DeploySRK.s.sol` mints all supply to the deployer and writes the address with the **3-arg**
`vm.writeJson(vm.toString(srk), "deployments/84532/addresses.json", ".SRK")` (or a separate
`deployments/84532/srk.json`) — a **2-arg** write would clobber the whole file. Then **hand-copy** the deployed
address into `packages/shared/src/addresses/baseSepolia.ts` (`srk`) and set `premiumTreasury` (the feature-014
Safe if it exists, else the deployer EOA with a recorded cutover note). SRK is **not** ABI-exported — the web
binds viem's `erc20Abi` at the call site.

## Apply the migration (before starting the agent)

```bash
cd services/agent
PGCLIENTENCODING=UTF8 uv run --group migrations yoyo apply --batch --database "$DATABASE_URL" ./migrations
```

`0017_subscriptions.sql` adds `payments` (`UNIQUE(network_id, tx_hash)`), `subscriptions`, and
`wallet_tier.expires_at`. **The migration number is the next free sequential number — confirm it is still free at apply time (011 already merged its 0016)
before applying; use the next free sequential number.** No `wallet_tier.source` ALTER is needed (`'srk'` is
already in the `0015` CHECK). Update `MIGRATIONS.md` (Develop → 0017) in the same change. **Apply
before the agent boots** (an un-applied table degrades silently). Set the billing env (read directly, not
through `AgentConfig`): `SRK_ADDRESS_84532`, `PREMIUM_PRICE_SRK` (flat **500 SRK/month** in base units),
`PREMIUM_TREASURY_ADDRESS`, `PREMIUM_MIN_CONFIRMATIONS`.

## Run

```bash
# agent (authoritative verifier + subscription grant + expiry-aware tier resolve)
cd services/agent && uv run uvicorn sparkpoint_agent.api.main:app --reload --port 8000
# web (real pay surface + BFF proxy + confirm gate)
pnpm --filter @sparkpoint/web dev
```

For a fast local demo, set `PREMIUM_MIN_CONFIRMATIONS` low (e.g. `1`) so a just-mined testnet tx grants quickly,
and set the free tier's `chat_daily_limit` low (Admin → Config) so the premium jump is easy to see.

## Verify by user story

**US1 — a user pays SRK and becomes premium for a month (🎯 MVP).** As a wallet holding ≥ 500 SRK on Base
Sepolia, open the Premium pay surface, sign the approve-if-needed + `transfer(treasury, price)` from your own
wallet, then let the client submit the tx hash to `POST /subscription/verify`. Confirm the wallet resolves to
**premium** on its next chat turn (premium caps + priority + model alias) with no re-authentication, and that the
grant carries an `expires_at` one month out. Confirm a wallet below the price sees an honest "insufficient SRK"
state and no sign action.

**US2 — the payment is verified on-chain, server-side, before any grant.** Feed the verifier the receipt matrix
and confirm only the valid case grants: a full-price payment **from the owner** grants; a payment from a
**different sender** is refused; an **under-price**, **reverted**, **wrong-recipient**, or **wrong-token** tx is
refused; an **unconfirmed/shallow** tx returns retryable-`pending` (not a grant, not a hard failure); a
**duplicate** of an already-granted hash is rejected by `UNIQUE(network_id, tx_hash)` — by the same or a
different wallet. Confirm the buyer is derived from `account.owner`, never the body.

**US3 — premium auto-expires to free, and renewals extend.** Grant a subscription with a **near-past**
`expires_at` and confirm the wallet resolves **free** on its next turn with **no** sweeper running; grant one
with a **future** expiry and confirm premium. Submit a second valid payment and confirm `expires_at` becomes
`max(now, current_expiry) + 1 month` in both the still-active and already-lapsed cases (extends, never resets).
Confirm an admin (008) grant with a **null** `expires_at` stays non-expiring.

**US4 — non-custodial, never gates withdraw (🛡️).** Assert the SRK movement is a single **user-signed** transfer
to the **disclosed** treasury with no SparkPoint-signed leg and no standing pull-approval to a SparkPoint
contract. Run the **custody-untouched** check: a free, lapsed, or verification-erroring wallet withdraws /
redeems / exits **exactly** as a premium one does — no premium/subscription/expiry/price check sits on any
funds-movement path. Confirm the treasury recipient address is disclosed and verifiable; if it is a multisig,
confirm it holds no fund-movement authority over user funds.

**US5 — the pay surfaces show real balance/price and route through a real confirm gate.** On the pay screen with
SRK deployed, confirm the displayed balance equals the on-chain `balanceOf(owner)` and the price is the
**configured** value (no hard-coded 320/500); confirm the flow presents an **approve leg** only when
`allowance(owner, treasury) < price`. Confirm "Review & sign" opens the real confirm gate, the sign button stays
hidden until the **fail-closed pre-sign check** passes, and success renders only after a **real** on-chain
confirmation. With SRK unset on the active chain, confirm an honest "unavailable" state and no sign action —
never a fabricated balance/price.

## Tests

```bash
# contract (unit + FUZZ before any mainnet consideration — Principle IV)
cd contracts && forge test --match-path 'test/token/SparkPointTestToken.t.sol'

# agent (authoritative verifier + store + expiry-aware resolve + custody-untouched)
cd services/agent && uv run pytest \
  tests/chain/test_payment_verifier.py tests/api/test_subscription.py \
  tests/db/test_subscriptions_store.py tests/db/test_limits_expiry.py \
  tests/api/test_custody_untouched.py

# web helpers + e2e
pnpm --filter @sparkpoint/web test
pnpm --filter @sparkpoint/web exec playwright test e2e/pw/premium-pay.spec.ts   # domcontentloaded + long hydration budget (CPU-starved box)
```

Cover: the full receipt matrix (valid / wrong-sender / under-price / reverted / shallow-pending / wrong-recipient
/ wrong-token / duplicate / RPC-outage); idempotent payment insert (one hash grants at most once); extending
renewal math; lazy expiry resolve (lapsed ⇒ free on the hot path, no sweeper); null-expiry admin grants stay
non-expiring; buyer-binding (`from == account.owner`); base-unit price comparison (no USD); the
custody-untouched assertion (no premium/expiry check on any withdraw/redeem/exit); the pay-screen real
balance/price reads + "SRK unavailable" honest-degrade.

## Living docs to update (same change)

- `CHANGELOG.md` — `## [Unreleased]` bullets (new SRK token + deploy script, `0017` migration, `payments`/`subscriptions`/`wallet_tier.expires_at`, `/subscription/verify` endpoint + verifier, expiry-aware resolve, real pay surface).
- `services/agent/content_seed/whats-new.json` — a client-facing entry with a **stable slug** ("Buy Premium with SRK"), backdated via `published_at` so the timeline reads honestly.
- `MIGRATIONS.md` — record `0017` applied per environment (**note the next-free number — confirm it is still free at apply time (011 already merged 0016)**).
- `DEVELOPMENT.md` — the new env vars (`SRK_ADDRESS_84532`, `PREMIUM_PRICE_SRK`, `PREMIUM_TREASURY_ADDRESS`, `PREMIUM_MIN_CONFIRMATIONS`) + the `srk` / `premiumTreasury` address-book fields.
- `DEPLOYMENT.md` / `COOLIFY.md` — the SRK deploy step + the agent billing env on the alpha.
