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
| 7 | US5 outcome logging | **BACKEND SPINE BUILT (020-A):** rec store (`0022`) + `/build-tx` writes `intent_bundles.recommendation_id` + FIFO per-deposit-lot `/outcomes` `recommendations[]` + `GET /outcomes/{recId}` — `intent_log` link, SC-010 met on the acted path | Web "By recommendation" surface (increment B) + persist-at-surface (durable UUID `recId` on `/recommendations`) |
| 8 | US2 swap sim + direct Aave v3 | **SUBSTANTIALLY DONE (018 + 019):** the `/build-tx` chokepoint + `/simulate` + `/submit-signed-tx` relay + status + `0021` persistence **AND** the web **ExecutionDrawer** single-signing UI all SHIPPED; only the Aerodrome swap sim + direct Aave + the richer Anvil-fork sim remain | Anvil-fork balance-delta/slippage sim; Aerodrome adapter/sim (mainnet); direct Aave v3 |

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

### 5. Notifications backend — **SHIPPED (021 phase 1: derive-on-read feed; phase 2: caps/rate/new-rec pollers). Only the session-key-expiry alert remains deferred (gated on US6).**
- **Shipped in 021 phase 1 (PR #97):** the in-app notifications feed + bell drawer are wired to a REAL
  backend — `GET /notifications` + `POST /notifications/read` (`api/notifications.py`). Every row is
  DERIVED live from indexed on-chain/DB activity — a vault Deposit/Withdraw flow, a realized outcome
  (`replay_outcomes`), a reverted/dropped execution — never fabricated (Principle III). Unread is a
  per-user two-part read cursor (`last_read_at` + `last_read_block`, migration `0023`) so a re-read is
  stable. Advisory read, fail-open (a degraded read yields a partial/empty feed, never a 500), never on
  the withdraw/exit path (N2). The web `StatusTag mock` on the page + drawer is retired.
- **Shipped in 021 phase 2 (this PR):** the three EDGE-TRIGGERED signals phase 1 couldn't derive on read
  (they watch for a CHANGE over time). A background poller (`api/notification_poller.py`, ~15-min tick,
  env-gated `NOTIF_POLLER_ENABLED`) + migration `0024` (`notification_events` + `notification_poller_state`)
  emit one real, deduped event per genuine crossing: **vault near capacity** (live `total_assets` vs the
  deposit cap ≥ 90%), **Aave rate moved** (live supply APY ≥ 25 bps from the last-notified level), and a
  proactive **new recommendation for you** (per active-mandate wallet, re-scores the real recommender and
  emits when the sorted SET of policy-cleared strategy KINDS gains a new kind — deterministic, so LLM
  rank/amount jitter never fires a false alert; one LLM call/wallet, bounded + gated by
  `NOTIF_POLLER_NEWRECS`). First observation per signal is a silent baseline; every detector is fail-open
  and off the request path (N2). No web change — the phase-1 feed renders the new categories/icons as-is.
- **Still deferred — session-key-expiry alert:** the `sessionKeyExpiry` NotifKey has no source until US6
  (session-key automation, item 1) exists — there is no session key to expire. **Do NOT fake it.** When
  US6 ships its ERC-4337 account + PolicyModule, add a poller detector that reads the on-chain session-key
  validUntil and emits `session_key_expiring` as the key nears expiry (category `sessionKeyExpiry`, which
  the settings page already lists, default-off). Gate to build = **US6 landed** (item 1).
- **Tracking:** `docs/design-handover/`; migrations `0023`/`0024`.

### 6. Admin stake / TVL / users analytics
- **Why deferred:** no analytics/TVL/revenue indexer backend; these admin panels render illustrative
  data. (Live-honest admin panels: gateway, allowlist, killswitch, system, audit, uptime, revenue, vaults.)
- **Current state / disclosure:** "Sample data" pill on `apps/web/src/app/admin/tvl/page.tsx`,
  `apps/web/src/app/admin/stake/page.tsx`, `apps/web/src/app/admin/users/page.tsx`,
  `apps/web/src/app/admin/page.tsx` (their chart provenance footers now read a static "sample data",
  not a false live pipeline).
- **Gate to build:** an analytics/indexer backend (TVL/stake/user rollups); replace the pill with live reads.
- **Tracking:** `docs/admin-panel/`.

### 7. US5 — outcome logging — **SHIPPED (020: backend spine A + web surface B + persist-at-surface T010); only a heuristic path + a persisted outcome table remain deferred**
- **Shipped in 018:** a REAL position-level realized-outcomes **ledger**. `GET /outcomes` reprojects
  the already-indexed Deposit/Withdraw flows (feature 017's `replay_basis`) into one row per realized
  withdrawal — realized USD (win/loss/flat, exact average-cost), each stamped with its own tx as
  on-chain proof — returned ONLY when the share history reconciles (else an honest empty state). The
  `/outcomes` page is **de-mocked** (the fabricated −$27.86 / fake tx links are gone).
- **Shipped in 020 (increment A — agent backend):** the per-**recommendation** attribution LINK is now
  BUILT. Migration `0022_recommendations` + `db/recommendations.py` persist a durable advice SNAPSHOT
  (UUID `id` = the wire `recId`, content-deduped). `POST /build-tx` resolves the `recommendationId` and
  WRITES `intent_bundles.recommendation_id` (the hardcoded `None` is fixed), advancing the rec
  `surfaced → acted` and linking `intent_log` (the explicit build→sign→execution chain, no heuristic).
  A new FIFO **per-deposit-lot** replay (`replay_lots`) marks each acted-on deposit to market;
  `GET /outcomes` gained a `recommendations[]` array and a new `GET /outcomes/{recId}` returns one rec's
  live outcome (entry/realized/unrealized/label/realized-APY, `shared` when blended). Everything
  reconstructable from chain; honest `DATA_STALE`/empty on an unreconcilable history. +47 tests.
  **SC-010 is met on the acted path** (every acted-on rec that submits + indexes generates an outcome).
- **Shipped in 020 (increment B — web surface, PR #92):** the **"By recommendation"** outcomes view
  (`outcomesView.ts` + `/outcomes/page.tsx` + `useOutcomeDetail`) consumes the `recommendations[]` +
  `/outcomes/{recId}` surfaces — realized/unrealized PnL, win/loss/open label, acted-tx proof, honest
  `intent_log` provenance + "Shared position" badge. The blanket "position-level — not yet linked"
  caveat is retired (kept only on the position-level withdrawal ledger). +14 web tests.
- **Shipped in 020 (persist-at-surface — T010, PR #93):** `GET /recommendations` now persists each
  cleared rec and returns a **durable UUID** `recId` (was strategy-keyed), pinned into
  `proposedAction.recommendationId` so the surfaced advice round-trips to `/build-tx` and resolves
  by id; idempotent by content; `/recommendations/{recId}` recomputes + re-keys through the store to
  resolve the UUID. **FAIL-OPEN** (a store outage degrades to the ephemeral id, never 503s). Live-
  validated end-to-end (surfaced UUID → build → rec `acted` + linked bundle). +2 agent tests.
- **Shipped in 020 (drawer retry-on-409, PR #95):** the ExecutionDrawer relay to `/submit-signed-tx`
  now fires **only after the receipt confirms** (the tx is retrievable on-chain, matching #91) and
  **retries a `409 DATA_STALE`** with a bounded backoff + one stable idempotency key, so a briefly-
  lagging real tx self-correlates without user action — never double-recording (agent caches only 2xx;
  `executions.UNIQUE(intent_bundle_id)` backstop) and never blocking the sign/exit flow (N2). +6 web tests.
- **Still deferred (US5 follow-ups — Phase 3):** (a) an optional **heuristic-match worker** for the
  legacy/unlinked path (the explicit `intent_log` path needs no worker); (b) a persisted
  `outcome_logs` table (outcomes are computed LIVE from chain today, which meets the AC). **The US5 /
  feature-020 attribution workstream is otherwise COMPLETE + live.**
- **Tracking:** `specs/020-us5-per-advice-attribution` (US5); `specs/018-p1-remainders` (US3); constitution III.

### 8. US2 — execution spine — **PARTIAL (shipped in 018 + 019)** + web drawer / swaps / direct Aave (deferred)
- **Shipped in 018:** a REAL pre-sign **dry-run** on the vault path. `POST /vault/simulate/{deposit,
  withdraw}` `eth_call`-dry-runs the ACTUAL mutating ERC-4626 calldata and returns `willRevert` +
  decoded reason + real `eth_estimateGas`; the confirm gate surfaces it as a third fail-closed signal
  (a **withdraw** dry-run is advisory and NEVER gates the exit, N2).
- **Shipped in 019 (the backend chokepoint):** the full `/build-tx` **IntentBundle** chokepoint +
  `POST /simulate` refresh + `POST /submit-signed-tx` relay (byte-matched, VR-X1) + `GET
  /submit-signed-tx/{intentId}` status + the **`0021` execution** persistence (`intent_bundles` /
  `simulation_results` / `executions`). An AI-proposed **vault** action (deposit/withdraw/redeem,
  `eoa_call`, `per_action`) now becomes a signable, simulated, policy-approved bundle — recipient
  forced to the user (N1), `signature` always null (N3), the exit never gated (N2), fail-closed with
  reasons + no bundle on rejection. `intent_bundles.id` is the `intent_action_id` (unblocks US5, row 7).
- **Shipped in 019 (the web ExecutionDrawer):** the front-end single-signing chokepoint. An APPROVED
  chat vault recommendation opens `apps/web/src/components/execution/ExecutionDrawer.tsx`, which calls
  `/build-tx`, renders the guardrail checklist + simulated balance changes + rationale, and signs the
  server `steps[0]` calldata **verbatim** via wagmi `useSendTransaction` (the byte-match, SC-005),
  confirming on the wallet's own RPC (N2 independence) + a best-effort `/submit-signed-tx` relay for
  correlation. Fail-closed (no Sign on a rejection); N2 exit stays signable with a null sim; the
  vault-screen manual flow + `/exit` are untouched.
- **Still deferred:** the full Anvil mainnet-fork balance-delta/slippage sim; **Aerodrome swap**
  simulation (mainnet-only); and **direct Aave v3** deposit/withdraw. **SC-002 remains UNMET for swaps.**
- **Gate to build:** the fork sim; Aerodrome adapter/sim (mainnet); direct Aave. The
  simulation-before-sign + single-signing-chokepoint guarantees now hold end-to-end (backend + UI) on
  the vault path.
- **Tracking:** `specs/019-us2-execution-spine`, `specs/018-p1-remainders` (US2), `specs/001-sparkpoint-pivot-mvp` (US2).

---

*Keep this file current in the same change that builds or re-scopes any row. When a row ships,
delete it here and (if it leaves a live caveat) move the residual to
[`known-limitations.md`](ops/known-limitations.md).*
