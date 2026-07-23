# Phase-3 deferred — descope register (develop, as-built)

Companion to [`known-limitations.md`](ops/known-limitations.md): that doc caveats what IS
deployed; this one lists what is **intentionally not built yet**, WHY, the **honest state the
app shows today**, and the **gate/condition** that must clear before we build it. Nothing on
this list ships as a silent mock — every row maps to an in-app disclosure (a `StatusTag`, a
"Sample data" pill, or an honest empty state) that a client can see.

Ratified scope lives in the [constitution](../.specify/memory/constitution.md); the mainnet
gate is [`GATES.md`](orchestration/GATES.md) Gate C; the machine record is the `P3` wave in
[`wave-state.json`](orchestration/wave-state.json). Framing rule (constitution III — *provable,
not promised*): a "gate" is a **condition**, not a delivery promise; Sui is a *commitment
pending its increment*, not a shipped-Base-equivalent proof.

| # | Deferred item | Honest in-app state today | Gate/condition to build |
|---|---|---|---|
| 1 | US6 session-key automation | `StatusTag mock` + "only you can move funds" | PolicyModule deployed + bundler ERC-7562 verdict |
| 2 | Base↔Sui bridge + Sui network | `StatusTag mock` "Unavailable during Alpha" | Sui (Move) custody increment designed; mainnet |
| 3 | Aerodrome swaps | Swap venue gated "mainnet only" | Base **mainnet** (no Sepolia Aerodrome) |
| 4 | Real Morpho wrapper + 010 APY feed | Demo wrapper on mock target; APY labeled/absent | Base mainnet Morpho + curated allowlist + APY feed |
| 5 | Notifications backend | `StatusTag mock` "not wired to a live feed" | Event/index backend + delivery channel |
| 6 | Admin stake/TVL/users analytics | "Sample data" pill | Analytics/indexer backend |
| 7 | US5 outcome logging | **PARTIAL (018):** real per-withdrawal ledger (`GET /outcomes`); per-**advice** attribution still deferred | Persisted recs + `intent_action_id` + IntentLog/attribution worker |
| 8 | US2 deterministic sim REST + direct Aave v3 | **PARTIAL (018):** real pre-sign `eth_call` dry-run on the vault (`/vault/simulate/*`); `/build-tx` chokepoint + swaps still deferred | `/build-tx` IntentBundle + ExecutionDrawer + submit relay + 0021 migration; Aerodrome sim; direct Aave |

---

### 1. US6 — session-key automation (ERC-4337 account + PolicyModule)
- **Why deferred:** the custom ERC-4337 account + `PolicyModule` are **undeployed** on Base Sepolia,
  and the safe-mode bundler spike could not render a clean ERC-7562 verdict on Anvil — the tracer
  caught a `recordSpend`-in-validation external-storage write to resolve first
  (`contracts/script/bundler-spike/`).
- **Current state / disclosure:** `/trust/permissions` says it plainly
  (`apps/web/src/app/(app)/trust/permissions/page.tsx`) — "only you can move funds; Sparky holds no
  on-chain grant"; `/automation` wears a `StatusTag mock` (`apps/web/src/app/(app)/automation/page.tsx`).
  See also `docs/ops/known-limitations.md`.
- **Gate to build:** deploy the AA stack (account/factory/validator/PolicyModule) + resolve the
  in-validation spend-write via a real tracing node / hosted bundler OR move the write to the
  account's own storage / stake the PolicyModule; then re-run the N4 refuter. Never autonomous (Gate C).
- **Tracking:** `specs/001-sparkpoint-pivot-mvp` (US6); constitution N4 / §IV.

### 2. Base↔Sui bridge + Sui network
- **Why deferred:** Sui is non-EVM (Move); it does **not** reuse the ERC-4337/4626 Base stack and is
  an explicit *separate follow-on technical design increment*. The old Base↔Sui form was a full mock.
- **Current state / disclosure:** `/bridge` renders `StatusTag mock` labeled **"Unavailable during
  Alpha"** (`apps/web/src/app/(app)/bridge/page.tsx`) + an honest notice + a **real** chain-keyed
  faucets panel instead. The route + nav entry stay.
- **Gate to build:** the Sui (Move) account/vault custody increment designed + the self-custodial
  bridge mechanism/provider chosen (user signs lock/burn on source, receives in their own wallet on
  destination — same sim + guardrail + you-sign gate); withdraw-always (N2) proven on Sui before the
  Sui self-custody claim is treated as demonstrated (constitution "Proof status…" para). Mainnet.
- **Tracking:** constitution I/II proof-status note; `docs/high-level-plan/`.

### 3. Aerodrome swaps
- **Why deferred:** Aerodrome is deployed on **Base mainnet only** — there is no Base-Sepolia
  deployment, so it cannot be exercised on testnet. Swaps themselves ARE live (Uniswap V3 on Base
  Sepolia; Synthra V3 on Robinhood 46630) — only the Aerodrome venue is gated.
- **Current state / disclosure:** `apps/web/src/lib/swap/dex.ts` marks Aerodrome as mainnet-only; the
  Swap page is `StatusTag live` for the venues that ARE live (`apps/web/src/app/(app)/swap/page.tsx`).
- **Gate to build:** Base **mainnet** (Gate C) — Aerodrome arrives with mainnet.
- **Tracking:** `specs/007-universal-swap`; constitution §IV.5 whitelist.

### 4. Real Morpho wrapper vault + 010 external APY feed
- **Why deferred:** curated Morpho vaults exist on **Base mainnet only** (no Base-Sepolia Morpho);
  the ratified `SparkPointVaultFactory` + wrapper CODE is merged and a **demo** wrapper is live on
  Base Sepolia against a **mock** target, but a *real* curated Morpho vault is mainnet-gated. The
  live APY feed that lets the AI see external yields (010 US1) is not wired.
- **Current state / disclosure:** `specs/010-universal-vaults/spec.md` ("Advisory + read-only ONLY";
  "External figures are labeled and fail-open"); `specs/011-wrapper-vault-factory/spec.md`. Vault UI
  reads live for the launch Aave vault only; wrapper APY renders "—".
- **Gate to build:** Base mainnet + a curated-allowlist Morpho vault admitted via the timelocked
  factory allowlist (constitution §IV.5) + the APY feed (Morpho GraphQL, per plan) wired so the AI
  reads real yields.
- **Tracking:** `specs/010-universal-vaults`, `specs/011-wrapper-vault-factory`; constitution §V.

### 5. Notifications backend
- **Why deferred:** there is no event/index backend to source transaction results or alerts; the
  screen (and the bell drawer) render mock data.
- **Current state / disclosure:** `StatusTag mock` "Preview — notifications aren't wired to a live
  feed yet." on both the page (`apps/web/src/app/(app)/notifications/page.tsx`) and the bell drawer
  (`apps/web/src/components/overlays/OverlayProvider.tsx`).
- **Gate to build:** an on-chain event/index backend + a delivery channel; wire the page + drawer to it.
- **Tracking:** `docs/design-handover/`.

### 6. Admin stake / TVL / users analytics
- **Why deferred:** no analytics/TVL/revenue indexer backend; these admin panels render illustrative
  data. (Live-honest admin panels: gateway, allowlist, killswitch, system, audit, uptime, revenue, vaults.)
- **Current state / disclosure:** "Sample data" pill on `apps/web/src/app/admin/tvl/page.tsx`,
  `apps/web/src/app/admin/stake/page.tsx`, `apps/web/src/app/admin/users/page.tsx`,
  `apps/web/src/app/admin/page.tsx` (their chart provenance footers now read a static "sample data",
  not a false live pipeline).
- **Gate to build:** an analytics/indexer backend (TVL/stake/user rollups); replace the pill with live reads.
- **Tracking:** `docs/admin-panel/`.

### 7. US5 — outcome logging — **PARTIAL (shipped in 018)**
- **Shipped in 018:** a REAL position-level realized-outcomes **ledger**. `GET /outcomes` reprojects
  the already-indexed Deposit/Withdraw flows (feature 017's `replay_basis`) into one row per realized
  withdrawal — realized USD (win/loss/flat, exact average-cost), each stamped with its own tx as
  on-chain proof — returned ONLY when the share history reconciles (else an honest empty state). The
  `/outcomes` page is **de-mocked** (the fabricated −$27.86 / fake tx links are gone).
- **Still deferred:** the per-**recommendation** attribution LINK (FR-039/SC-010 — "100% of acted-on
  recs logged + PnL-updated per rec"). It needs persisted recommendations + an `intent_action_id`
  minted at proposal time + an IntentLog/heuristic attribution worker, which structurally depend on
  US2's execution-persistence spine. **SC-010 remains UNMET;** the ledger is honestly labeled
  "position-level — not yet linked to the specific advice."
- **Gate to build:** the recommendation store + `intent_action_id` + attribution worker (with US2's
  execution tables).
- **Tracking:** `specs/018-p1-remainders` (US3), `specs/001-sparkpoint-pivot-mvp` (US5); constitution III.

### 8. US2 — deterministic simulation — **PARTIAL (shipped in 018)** + direct Aave v3 (deferred)
- **Shipped in 018:** a REAL pre-sign **dry-run** on the vault path. `POST /vault/simulate/{deposit,
  withdraw}` `eth_call`-dry-runs the ACTUAL mutating ERC-4626 calldata (via the already-built
  `viem_eth_call` checker) and returns `willRevert` + decoded reason + real `eth_estimateGas`; the
  confirm gate surfaces it as a third fail-closed signal — a predicted **deposit** revert disables
  Sign (saves gas), a **withdraw** dry-run is advisory and NEVER gates the exit (N2). Deposit reads
  the live allowance first so a pre-approval state is an honest "approve first", not a false revert.
- **Still deferred:** the full `/build-tx` **IntentBundle** chokepoint + `ExecutionDrawer` + the
  `POST /submit-signed-tx` relay + the **0021 execution** persistence (intent_bundles /
  simulation_results / executions); full Anvil mainnet-fork balance-delta/slippage; **Aerodrome swap**
  simulation; and **direct Aave v3** deposit/withdraw. **SC-002 remains UNMET for swaps.**
- **Gate to build:** the `/build-tx` chokepoint + submit relay + 0021 migration; the fork sim;
  Aerodrome adapter/sim; direct Aave. The simulation-before-sign guarantee holds on the vault path today.
- **Tracking:** `specs/018-p1-remainders` (US2), `specs/001-sparkpoint-pivot-mvp` (US2).

---

*Keep this file current in the same change that builds or re-scopes any row. When a row ships,
delete it here and (if it leaves a live caveat) move the residual to
[`known-limitations.md`](ops/known-limitations.md).*
