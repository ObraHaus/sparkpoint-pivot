# Implementation Plan: Premium Purchase via SRK

**Branch**: `feature/012-premium-srk-purchase` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-premium-srk-purchase/spec.md`

## Summary

Let a user **buy** the premium tier that feature 008 built by paying a SparkPoint **test SRK** token on
Base Sepolia. A new OpenZeppelin ERC-20 (`SparkPoint Test Token`, `SRK`, 18 decimals, deployer-minted, no
faucet) is deployed via a new `contracts/script/DeploySRK.s.sol`; the web pay screen reads the user's **real**
SRK balance/allowance (viem `erc20Abi`) and drives a **user-signed** two-leg approve-then-`transfer` to a
disclosed `premiumTreasury` through a new `useExecutePremiumTx.ts` (a clone of `useExecuteSwapTx.ts`),
surfaced through the real confirm gate (the `premium` intent is already whitelisted). The client then submits
only the **tx hash** to a new agent endpoint `POST /subscription/verify` (`api/subscription.py`), where a new
keyless `chain/payment_verifier.py` — reusing `data/log_source.py`'s `HttpxLogsRpc` +
`_addr_from_topic` — reads the receipt and asserts: `status == 0x1`, `head − blockNumber ≥
PREMIUM_MIN_CONFIRMATIONS`, and an ERC-20 `Transfer` log where `address == SRK`, `to == premiumTreasury`,
`from == account.owner` (the server-scoped buyer, **never** a body field), and `value ≥ PREMIUM_PRICE_SRK`
(compared in **base units** — there is no USD oracle).

Verified payments are recorded in a new forward-only migration **`0017_subscriptions.sql`**: a `payments`
ledger whose **`UNIQUE(network_id, tx_hash)`** is the anti-replay control (not the BFF `Idempotency-Key`), a
`subscriptions` window table, and a new nullable **`wallet_tier.expires_at`**. The grant reuses the 008
`LimitsStore.assign(wallet, "premium", source='srk')` (`srk` is already in the `0015` CHECK — no ALTER), and
expiry is enforced **lazily on the hot path** by extending 008's `_RESOLVE_SQL` to `… AND (expires_at IS NULL
OR expires_at > now())` — a lapsed row resolves to free with no sweeper. A renewal **extends**
(`expires_at = max(now, current_expiry) + 1 month`). The premium/expiry check stays exactly where 008 put it —
the three advisory-compute routes — and **never** touches withdraw/redeem/exit (N2), proven by a
custody-untouched test.

**Technical approach** (from research.md): wire, do not invent — thread three proven engines (the 008 tier
gate, the 007 user-signed approve+pay pattern, and the `fee_indexer`/`log_source` keyless receipt-decode
primitives) plus one migration. The verifier reuses the raw-result `HttpxLogsRpc` transport (a receipt is a
JSON object the string-only vault transport would reject) and the hardcoded `ERC20_TRANSFER_TOPIC0`
constant, so it stays keyless and keccak-free. The grant reuses the 008 store; expiry is a one-clause change
to the existing resolve SQL, keeping a single resolution source (`wallet_tier`) and the `subscriptions`
ledger as history only — no dual-source drift. New billing constants are read directly (like
`PREMIUM_ALLOWLIST`), kept out of the keyless `AgentConfig`.

## Technical Context

**Language/Version**: Solidity 0.8.24 / Foundry (`contracts` — the SRK token + deploy script); Python 3.12
(`services/agent`, FastAPI/Starlette — the authoritative verifier, subscription store, and grant/expiry
logic); TypeScript 5 (Next.js 15 App Router, React 19 — the pay surface, the premium exec controller, and the
confirm-gate wiring).

**Primary Dependencies**: OpenZeppelin v5.1.0 `ERC20` + `forge-std/Script` (contract + deploy); `httpx`
(keyless JSON-RPC via the existing `HttpxLogsRpc`), `asyncpg`, `yoyo` (agent); wagmi/viem (`erc20Abi`,
`writeContractAsync`, `waitForTransactionReceipt`) on the web. Reuses 008's `LimitsStore` and `require_admin`
patterns and 007's `useExecuteSwapTx` two-leg shape. **No new runtime dependency.**

**Storage**: Postgres (agent-owned) — one new migration `services/agent/migrations/0017_subscriptions.sql`
(`payments`, `subscriptions`, `wallet_tier.expires_at`). *Migration `0017` is the next free number — `0016_vault_factory` (feature 011) is the latest on develop; confirm it is still free when you create the file.* No key material stored;
RPC DSN passed at apply time. On-chain SRK/treasury addresses live in `packages/shared/src/addresses/`.

**Testing**: Foundry unit **and fuzz** tests for the SRK token (supply, decimals, transfer/approve invariants)
before any mainnet consideration (Principle IV); `pytest` for the verifier (the full receipt matrix:
valid/wrong-sender/under-price/reverted/shallow/wrong-recipient/duplicate/RPC-outage), the subscription store
(idempotent payment insert, extending renewal, lazy expiry resolve), and a **custody-untouched** assertion;
`node:test`/Vitest for the pay-screen helpers; Playwright e2e for the approve→pay→verify→premium round-trip
and the "SRK unavailable" honest-degrade.

**Target Platform**: Base Sepolia (84532) for the SRK contract; the Python agent + Next.js web on the Coolify
dev/staging alpha.

**Project Type**: Web application — Solidity contract + Python agent service + Next.js frontend.

**Performance Goals**: verification is one `eth_getTransactionReceipt` + one `eth_blockNumber` per submit
(off the assistant hot path); the expiry check adds **nothing** — it is one extra predicate on the existing
008 tier-resolve query; the hot path stays a single indexed read.

**Constraints**: buyer = server-scoped `account.owner`, **never** a body field; **finality-gated**
(`head − blockNumber ≥ N`; pending ⇒ retryable, not a grant); **anti-replay** via `UNIQUE(network_id,
tx_hash)` (not the idempotency key); price compared in **SRK base units** (no USD oracle); expiry resolved
**lazily** on the hot path (no sweeper); renewal **extends** not resets; premium/expiry check **only** on the
three advisory routes, **never** on custody (N2); SRK/premium **non-essential** to the vault (Principle V);
Base-Sepolia-only, fail-closed elsewhere.

**Scale/Scope**: 1 new ERC-20 (84532); 1 new agent endpoint + 1 verifier + 1 subscription store; 1 migration
(3 objects); 1 address-book field pair; 1 web exec controller + the pay screen + the confirm-gate
generalization; ~1 agent replica; 1 price constant; premium unchanged as an advisory-compute-only entitlement.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.3.0.

| Principle | Assessment |
|---|---|
| **I. Non-Custodial by Construction (N1–N5, NON-NEGOTIABLE)** | **PASS.** SRK moves only via a transfer the **user signs from their own key** to a **disclosed** treasury — no SparkPoint-signed leg, no custodied sweep, no standing pull-approval to a SparkPoint contract (N1, N3). The premium/expiry check sits only on the three advisory-compute routes and is **never** attached to withdraw/redeem/exit — proven by a custody-untouched test (FR-017/SC-005, N2). If the treasury is a multisig it is a plain recipient with zero fund-movement authority over user funds (FR-019, N5). No custody semantics, session keys, or caps change (N4). |
| **II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)** | **PASS.** The payment is user-initiated and user-signed; the assistant proposes nothing on-chain here and the model never holds authority to move SRK. Granting premium only changes which *advisory* allowances apply — it cannot cause or suppress any on-chain action, and the deterministic policy + user-sign path is untouched. |
| **III. Provable, Not Promised** | **PASS.** The grant is gated on a **real on-chain receipt** verified server-side (FR-005), never a client claim; the pay surface shows the **real** SRK balance/price and the **disclosed** treasury address, and honest-degrades to "unavailable" when SRK is unconfigured (FR-020/FR-022) rather than fabricating. No dollar figure is presented as anything but an illustrative peg (FR-003). |
| **IV. Security & Bounded Blast Radius** | **PASS.** Verification is buyer-bound (`from == owner`), replay-proof (`UNIQUE(network_id, tx_hash)`), and finality-gated (`head − blockNumber ≥ N`) — the three exploits (claim another's payment, replay a hash, reorg a shallow tx) are closed by construction (FR-006/FR-011/FR-007). The SRK contract is a minimal auditable ERC-20 with **unit + fuzz** tests before any mainnet use. The vault, its caps, the pause-only kill-switch, and the Aave/Aerodrome whitelist are untouched (a user-signed SRK payment sits outside the policy-gated execution path — recorded scope note below). |
| **V. Conservative, Transparent Launch** | **PASS.** SRK stays **non-essential**: the vault, deposits, yield, swaps, and withdraw-always work fully without SRK or premium; nothing core is gated on SRK ownership (FR-018). This is the constitution's authorized "later increment that flips the 008 engine on," on a supported test network only (Base Sepolia), with a fixed SRK price and no new vault fee. |
| **VI. Spec-Driven Development (NON-NEGOTIABLE)** | **PASS.** spec → plan → tasks; no code before tasks; plan/spec/research trace to each other and to the constitution and 008. |
| **VII. Simplicity & YAGNI** | **PASS with a recorded scope note (below).** Reuses the 008 store/resolve, the 007 approve+pay shape, and the `log_source` receipt-decode primitives; one migration; one price constant; no SRK v2 utility/staking/governance is built. Base-Sepolia-only. |

**Recorded scope note (Principle VII / V / IV.5 — a paid SRK path on top of the 008 engine).** The
constitution defers "SRK v2 utility and governance" and requires "the SRK token MUST be non-essential to core
vault function." This feature builds **only** the buy-verify-grant path that flips the already-built 008
premium engine on: a fresh test SRK ERC-20, a **user-signed** payment to a **disclosed** recipient, and a
server-side on-chain verification — it builds **no** SRK staking, governance, or v2 utility, and adds **no**
new vault fee. The user-signed SRK transfer sits **outside** the agent/vault policy-gated execution path, so
Guardrail IV.5 (the Aave/Aerodrome protocol whitelist) is not engaged — recorded here exactly as 007 recorded
its user-signed swap fee. Premium remains advisory-compute-only and never gates the vault/custody/withdraw
path. This is client/operator-directed (2026-07-21) and **does not touch N1–N5**, the policy engine, the
pause-only kill-switch, or the non-upgradeable vault semantics, so **no re-ratification is required**. The
`premiumTreasury` should point at the feature-014 fee Safe if it exists at build time (a plain recipient, not
the vault guardian — the guardian is immutable and unchanged); otherwise the deployer EOA with a recorded
cutover note.

**Result: GATE PASS** — proceed to Phase 0. No unresolved NON-NEGOTIABLE violations.

## Project Structure

### Documentation (this feature)

```text
specs/012-premium-srk-purchase/
├── plan.md                    # This file
├── spec.md                    # WHAT/WHY (approved)
├── research.md                # Phase 0 — decisions & rationale
├── data-model.md              # Phase 1 — entities, tables, wire shapes
├── quickstart.md              # Phase 1 — how to run/verify locally + per-story checks
├── contracts/
│   └── premium-srk-interfaces.md    # Phase 1 — internal interface contracts (verifier, verify API, store, exec)
├── checklists/
│   └── requirements.md        # Spec-quality checklist (from specify)
└── tasks.md                   # Phase 2 — /speckit-tasks output (task list)
```

### Source Code (repository root)

```text
contracts/
├── src/token/SparkPointTestToken.sol   # NEW — OZ ERC20("SparkPoint Test Token","SRK"), 18dp, all supply → deployer, no faucet
├── script/DeploySRK.s.sol              # NEW — mirrors DeploySepolia.s.sol; write addr via 3-arg vm.writeJson(addr, "deployments/84532/addresses.json", ".SRK") OR a separate srk.json (a 2-arg write clobbers the file)
└── test/token/SparkPointTestToken.t.sol # NEW — unit + FUZZ (supply, decimals, transfer/approve invariants) before mainnet (Principle IV)

packages/shared/src/addresses/
├── types.ts                    # add plain optional fields  srk?: Address  ·  premiumTreasury?: Address  (NOT TargetRefs — no TARGET_REF_FIELD, no parity impact)
└── baseSepolia.ts              # fill in the deployed SRK address + premiumTreasury (014 Safe if present, else deployer EOA)

services/agent/migrations/
└── 0017_subscriptions.sql      # NEW (0017 — feature 011 holds 0016; confirm next-free at apply time) — payments (UNIQUE(network_id,tx_hash)), subscriptions, ALTER wallet_tier ADD expires_at

services/agent/src/sparkpoint_agent/
├── chain/payment_verifier.py   # NEW — keyless: HttpxLogsRpc.call("eth_getTransactionReceipt",[txHash]) + eth_blockNumber + _addr_from_topic; ERC20_TRANSFER_TOPIC0; assert status/confirmations/token/to/from/value
├── api/subscription.py         # NEW — POST /subscription/verify {txHash}; buyer=account.owner; VALIDATION_ERROR / UPSTREAM_UNAVAILABLE / retryable-pending
├── api/main.py                 # include_router(subscription_router)
├── db/subscriptions.py         # NEW — SubscriptionStore (mirror db/limits.py): idempotent payment insert + subscription upsert + audit, one tx
├── db/limits.py                # CHANGE _RESOLVE_SQL (:44) → "... AND (expires_at IS NULL OR expires_at > now())"; assign(...) accepts expires_at; source='srk' (already in 0015 CHECK)
└── config.py                   # unchanged (keyless) — PREMIUM_PRICE_SRK / SRK_ADDRESS_84532 / PREMIUM_TREASURY_ADDRESS / PREMIUM_MIN_CONFIRMATIONS read directly, like PREMIUM_ALLOWLIST

apps/web/src/
├── lib/chain/useExecutePremiumTx.ts    # NEW — clone useExecuteSwapTx.ts: leg-0 approve(treasury,price) if allowance<price; leg-1 transfer(treasury,price); writeContractAsync → waitForTransactionReceipt; status==="reverted" ⇒ fail-closed; user sole signer
├── app/(app)/premium/pay/page.tsx      # REPLACE hardcoded balance=320/price=500 with erc20.balanceOf(owner) + allowance(owner,treasury) + config price; wire "Review & sign" to the built exec (not router.push placeholder)
├── app/(app)/premium/page.tsx          # drop StatusTag variant="mock"; real SRK/price; keep the existing /usage/self read
├── components/screens/…/ConfirmFlow.tsx + OnchainConfirmFlow  # generalize past deposit|withdraw for the already-whitelisted "premium" intent OR add an inline confirm modeled on inline-swap-confirm.tsx; sign gated behind a fail-closed pre-sign check
└── lib/agent/…                 # typed client call to POST /api/agent/subscription/verify {txHash}

Living docs: CHANGELOG.md · MIGRATIONS.md (0017 apply record) · DEVELOPMENT.md (SRK_ADDRESS_84532,
PREMIUM_PRICE_SRK, PREMIUM_TREASURY_ADDRESS, PREMIUM_MIN_CONFIRMATIONS + the srk/premiumTreasury address-book fields) ·
DEPLOYMENT.md/COOLIFY.md (SRK deploy + agent env) · services/agent/content_seed/whats-new.json (client-facing entry, stable slug)
```

**Structure Decision**: Web-application layout (Solidity contract + Python agent + Next.js frontend). The
authoritative logic is concentrated in `services/agent` (the keyless verifier, the subscription store, the
one-clause expiry change, and the verify endpoint); `contracts` gains a minimal test SRK + deploy script;
`apps/web` gains the real balance/price reads, the premium exec controller, and the confirm-gate wiring; the
shared address book gains two optional non-policy fields. No new top-level project.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| New `chain/payment_verifier.py` (not reusing the vault reader) | A receipt is a JSON **object**; the string-only `HttpxJsonRpcTransport` rejects arrays/objects, so the raw-result `HttpxLogsRpc` is the correct transport | Forcing receipts through the vault reader would need a new transport branch there; a small dedicated verifier reusing `log_source`'s primitives keeps both modules single-purpose and keyless |
| `expires_at` on `wallet_tier` **and** a `subscriptions` ledger | Resolution must be a single hot-path source (`wallet_tier`) to avoid dual-source drift; audit/history needs its own append-only record (`subscriptions`/`payments`) | Putting expiry only in `subscriptions` would leave 008's existence-only resolve granting lapsed premium until a sweeper runs (drift + a new background job); putting history only in `wallet_tier` loses the payment/renewal audit trail |
| Generalize the confirm gate past `deposit\|withdraw` (or an inline premium confirm) | The real sign path (`OnchainConfirmFlow`) is hardwired to the two vault sides; premium needs a third exec variant behind the same fail-closed pre-sign gate | Landing "Review & sign" on the existing placeholder (current behavior) never builds a tx — it looks live but is a mock (Principle III violation); a real gate is required to sign honestly |

## Phased design (maps to spec user stories)

Each phase is independently shippable to `develop` and honest at its own boundary.

- **Phase 0 — Token + address groundwork (no app behavior change).** `SparkPointTestToken.sol` + unit/fuzz
  tests + `DeploySRK.s.sol`; deploy to Base Sepolia; add `srk?`/`premiumTreasury?` to the address-book
  `types.ts` and fill `baseSepolia.ts` (treasury = 014 Safe if present, else deployer EOA + cutover note).
  Nothing grants yet.
- **Phase A → US1 (🎯 MVP).** Migration `0017_subscriptions.sql` (payments/subscriptions/`expires_at`, number
  working — confirm it is still free at apply time (011 already merged 0016)) applied with `PGCLIENTENCODING=UTF8` before agent boot; `db/subscriptions.py`;
  `chain/payment_verifier.py`; `api/subscription.py` `POST /subscription/verify`; grant via
  `LimitsStore.assign(..., source='srk', expires_at=now+1mo)`. A valid payment → premium for a month, resolved
  on the next turn. Buy-and-grant is a viable MVP.
- **Phase B → US2.** Harden the verifier to the full matrix: buyer-binding (`from == owner`),
  `UNIQUE(network_id, tx_hash)` anti-replay, finality gate (`head − blockNumber ≥ N` + retryable-pending),
  token/recipient/amount asserts in base units, RPC-outage → `UPSTREAM_UNAVAILABLE`. Verifier is
  independently testable against the receipt matrix.
- **Phase C → US3.** Change 008's `_RESOLVE_SQL` to honor `expires_at` (lazy free on the hot path, no
  sweeper); extending-renewal math (`max(now, current_expiry) + 1 month`); null-expiry admin grants stay
  non-expiring.
- **Phase D → US4 (🛡️).** The custody-untouched test (no premium/expiry/subscription/price check on any
  withdraw/redeem/exit); assert the payment has no SparkPoint-signed leg and no standing pull-approval;
  disclose + verify the treasury recipient; confirm a multisig treasury holds no fund-movement authority.
- **Phase E → US5.** Wire the pay surface to real `balanceOf`/`allowance` + config price;
  `useExecutePremiumTx.ts` (approve-if-needed → transfer); route "Review & sign" through the real confirm gate
  behind the fail-closed pre-sign check; honest "unavailable" when SRK is unconfigured; drop the mock tag.
