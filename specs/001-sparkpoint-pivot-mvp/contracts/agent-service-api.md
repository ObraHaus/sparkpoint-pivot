# Contract: Agent Service API (Frontend ↔ Orchestrator)

**Feature:** 001-sparkpoint-pivot-mvp · **Layer seam:** User Layer (Next.js) ↔ AI Orchestration Layer (self-hosted OpenClaw/Hermes, FastAPI).
**Status:** Phase 1 contract. Transport: HTTPS + Server-Sent Events (SSE). Content type `application/json` unless noted (`text/event-stream` for streams).

---

## 0. The non-custody contract (READ FIRST — binds every endpoint below)

This service is **advisory and read/derive only**. It is structurally incapable of moving user funds.

1. **No keys.** The service never generates, holds, escrows, imports, or recovers a private key, seed phrase, or signed payload. There is no field anywhere in this API that returns a signature or a signed transaction. (N1, N3)
2. **Unsigned + simulated only.** The most powerful artifact any endpoint returns is an **`IntentBundle`**: inert, unsigned ERC-4337 `UserOperation` calldata (or raw EOA-call calldata) **plus** a Tenderly simulation preview **plus** a deterministic `PolicyVerdict`. The user's own wallet signs it; the frontend submits it to a bundler/RPC. The service's involvement ends at bundle emission. (N1, N3, FR-008, FR-022, FR-033)
3. **Recipient is never SparkPoint.** Every build endpoint forces the fund recipient to the user's own `SparkPointAccount` or owner EOA. No build path can name a SparkPoint-controlled or arbitrary external address as a recipient. (N1)
4. **Withdraw is never gated here.** This service is NOT on the withdrawal path. If it is entirely offline, the user still exits on-chain directly (see `/exit` in the frontend, which imports no agent client). Quote endpoints for withdraw exist only as a convenience; their unavailability never blocks an on-chain redeem/withdraw. (N2)
5. **Fail-closed.** Any action that is malformed, out-of-policy, over-cap, over-slippage, predicted-to-revert, or built on stale-beyond-tolerance data is returned WITHOUT a signable bundle — as an explanation, never as a signature request. (G1, G4, FR-023, FR-024, FR-027)
6. **Deterministic policy is authoritative, not the LLM.** Every state-changing artifact carries a `policyVerdict` produced by the pure, LLM-free policy layer (mirror of the on-chain `PolicyModule`). The model's text is advisory. (G1)

> The on-chain `PolicyModule` / `SessionKeyValidator` / vault are the *final* backstop. This API is the off-chain mirror; if this API and chain ever disagree, chain wins and the action reverts on-chain (caught earlier by the simulation gate).

---

## 1. Conventions

### 1.1 Base URL & versioning
- Base path: `/api/v1`. Breaking changes bump the path segment (`/api/v2`).
- All examples below are relative to the base path.

### 1.2 Auth & session
- The web tier authenticates to the agent service with a **service-to-service bearer token** (`Authorization: Bearer <web-tier-token>`); the browser never calls the agent directly with custody authority.
- User identity is the **smart-account address** (the identity anchor) plus the connected **owner EOA**, asserted by the web tier after a SIWE-style wallet proof it performs. Passed as:
  - `X-Account: 0x<smartAccount>` (the user's `SparkPointAccount`, may be counterfactual/undeployed)
  - `X-Owner: 0x<ownerEoa>` (the sole admin signer)
  - `X-Chain-Id: 8453` (Base mainnet) | `84532` (Base Sepolia)
- The service NEVER treats these headers as authority to move funds — they scope reads/derivations and bind proposals to a user. Authority lives in the user's wallet.

### 1.3 Idempotency
- All `POST` build/mutating endpoints accept an `Idempotency-Key` header (UUID). Replays return the original response. `IntentBundle`s are idempotent and short-lived (`expiresAt`).

### 1.4 Money & numbers
- All token amounts are **raw integer base units as JSON strings** (e.g. USDC `"100000000"` = 100.00 USDC) with a sibling `decimals` field. Never floats (float drift breaks reconstructability).
- USD values are decimal strings (`"100.00"`) and always carry `priceSource` + `asOfBlock`.

### 1.5 Standard error envelope
All non-2xx responses share this shape:

```json
{
  "error": {
    "code": "POLICY_REJECTED",
    "httpStatus": 422,
    "message": "Human-readable explanation surfaced in chat/UI.",
    "reasons": [
      { "code": "CAP_PER_USER_EXCEEDED", "message": "Deposit would exceed your per-user cap of 5,000 USDC by 1,200 USDC." }
    ],
    "policyVersion": "policy@2026.06.0",
    "retryable": false,
    "requestId": "req_01H...",
    "simulation": null
  }
}
```

### 1.6 Canonical error codes

| `code` | HTTP | Meaning | Retryable |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing/invalid web-tier bearer token | no |
| `ACCOUNT_HEADERS_INVALID` | 400 | `X-Account`/`X-Owner` malformed or mismatched | no |
| `VALIDATION_ERROR` | 400 | Request body fails schema validation | no |
| `NOT_FOUND` | 404 | Unknown id (rec, intent, session, position) | no |
| `BETA_NOT_ENABLED` | 403 | Address not on whitelist (does NOT gate `/exit` or `/trust`, which are frontend-only) | no |
| `GEO_BLOCKED` | 451 | Restricted region (app surfaces only; never withdraw) | no |
| `POLICY_REJECTED` | 422 | Deterministic policy layer rejected (allowlist/asset/mandate/recipient) | no |
| `CAP_EXCEEDED` | 422 | Per-user / total / vault / per-tx cap breach (deposit-side only) | no |
| `SLIPPAGE_EXCEEDED` | 422 | Simulated slippage > user max | no (re-quote) |
| `SIMULATION_REVERT` | 422 | Tenderly predicts revert; `simulation.revertReason` set | maybe |
| `SIMULATION_UNAVAILABLE` | 503 | Tenderly down; for swaps this fail-closes (no bundle). Custody ops may fall back to local `eth_call` dry-run | yes |
| `DATA_STALE` | 409 | Required input older than tolerance; execution blocked, custody/withdraw unaffected | yes |
| `KILL_SWITCH_PAUSED` | 409 | New deployments/deposits paused. **Never returned for withdraw/redeem/revoke** | no |
| `UPSTREAM_UNAVAILABLE` | 502/503 | Claude / Dune / DeFiLlama / subgraph / RPC degraded | yes |
| `REFUSAL` | 422 | Model refused (`stop_reason == "refusal"`); safe fallback text returned, no fabricated rec | no |
| `RATE_LIMITED` | 429 | Throttled; `Retry-After` header set | yes |
| `INTERNAL` | 500 | Unexpected error | yes |

---

## 2. Shared schemas

### 2.1 `IntentBundle` (the only state-changing artifact)

```jsonc
{
  "id": "intent_01H...",                 // correlation id; lands on-chain (IntentLog) for PnL attribution
  "userId": "0x<smartAccount>",
  "kind": "vault_deposit",               // see ActionType enum (§2.2)
  "steps": [                             // ordered; may be multi-step (e.g. approve + deposit)
    {
      "chainId": 8453,
      "opType": "userop",                // "userop" (ERC-4337) | "eoa_call" (direct)
      "to": "0x<target>",                // an allowlisted target ONLY (vault | Aave Pool/gateway | Aerodrome Router)
      "value": "0",
      "data": "0x<calldata>",            // UNSIGNED calldata. Recipient fields forced to userId/owner.
      "label": "Approve USDC to vault"
    }
  ],
  "userOp": {                            // present when opType=userop; UNSIGNED PackedUserOperation (EntryPoint v0.7)
    "sender": "0x<smartAccount>",
    "nonce": "0x...",
    "factory": null,                     // set with factoryData when account is counterfactual (first tx)
    "factoryData": null,
    "callData": "0x...",
    "callGasLimit": "0x...",
    "verificationGasLimit": "0x...",
    "preVerificationGas": "0x...",
    "maxFeePerGas": "0x...",
    "maxPriorityFeePerGas": "0x...",
    "paymaster": null,                   // optional gas sponsor; NEVER a fund authority (gas only)
    "paymasterData": null,
    "signature": null                    // ALWAYS null. The service never signs. The wallet fills this.
  },
  "simulation": { /* SimulationResult §2.3 */ },
  "policyVerdict": { /* PolicyVerdict §2.4 — approved=true here */ },
  "guardrailChecklist": [ /* GuardrailCheck §2.5 — rendered in ExecutionDrawer */ ],
  "rationale": "Plain-language why (FR-006).",
  "citations": [ /* Citation §2.6 */ ],
  "recommendationId": "rec_01H...",      // optional link to outcome log (FR-039)
  "policyVersion": "policy@2026.06.0",
  "expiresAt": "2026-06-15T12:34:56Z"    // short-lived; stale bundles must be rebuilt
}
```

`signature` is **always `null`**. There is no request or response in this API where it is non-null on the wire from the service.

### 2.2 `ActionType` enum

`vault_deposit` · `vault_withdraw` · `vault_redeem` · `aave_supply` · `aave_withdraw` · `aerodrome_swap` · `session_key_grant` · `session_key_revoke`.

### 2.3 `SimulationResult` (Tenderly preview)

```jsonc
{
  "provider": "tenderly",                // or "viem_local" fallback for oracle-free custody ops
  "willRevert": false,
  "revertReason": null,
  "balanceDeltas": [ { "asset": "0xUSDC", "decimals": 6, "delta": "-100000000", "deltaUsd": "-100.00" } ],
  "sharesOut": "98765432",               // for deposits (previewDeposit-consistent)
  "assetsOut": null,                     // for withdraws/redeems
  "outAmount": null,                     // for swaps
  "minOut": null,                        // amountOutMin embedded in swap calldata
  "priceImpactBps": 0,
  "slippageBps": 0,
  "feesUsd": "0.00",                     // protocol fee charged ON THIS tx: 0 (entry/exit/management = 0; perf fee is profit-only & taken as share dilution, not a tx-time deduction). Gas shown separately
  "gas": { "estimate": "0x...", "gasUsd": "0.02" },
  "capHeadroom": { "perUser": "4900000000", "total": "...", "vault": "..." },
  "asOfBlock": 0,
  "asOf": "2026-06-15T12:34:00Z"
}
```

### 2.4 `PolicyVerdict` (deterministic, LLM-free)

```jsonc
{
  "approved": true,
  "policyVersion": "policy@2026.06.0",
  "reasons": [ { "code": "OK", "message": "All checks passed." } ],
  "normalizedAction": { /* canonical Action; null if rejected */ },
  "simulation": { /* SimulationResult, mirrored */ }
}
```
When `approved=false`, the endpoint returns a non-2xx error (§1.5) and **no `IntentBundle`** — the `reasons[]` are surfaced to the user.

### 2.5 `GuardrailCheck` (rendered as the confirmation checklist)

```jsonc
{ "id": "protocol_allowlisted", "label": "Target is a whitelisted protocol (Aave v3)", "status": "pass", "detail": "0x<aavePool>" }
```
`status`: `pass` | `fail` | `warn`. Statuses map 1:1 to the six guardrails (G1–G6) plus the recipient check (N1).

### 2.6 `Citation`

```jsonc
{ "provider": "DeFiLlama", "endpoint": "/yields/pool/...", "field": "apy", "value": "4.21", "asOf": "2026-06-15T12:30:00Z", "stale": false, "url": "https://..." }
```

### 2.7 `ChatBlock` (streamed envelope — validated by frontend Zod, fail-closed)

```jsonc
// type ∈ text | tool_step | recommendation | action | portfolio_snapshot | tip | outcome | citation | error
{ "type": "text", "markdown": "..." }
{ "type": "tool_step", "label": "Reading your Aave position", "status": "running" }   // running|done|error
{ "type": "recommendation", "recId": "rec_01H...", "title": "Supply USDC to the vault",
  "rank": 1, "rationale": "...", "protocol": "aave_v3",
  "proposedAction": { /* ProposedAction, NOT yet built/signable */ },
  "policy": { "status": "approved", "checks": [ /* GuardrailCheck */ ] }, "citations": [] }
{ "type": "action", "proposedAction": { /* ... */ },
  "policy": { "status": "rejected", "reason": "Exceeds per-user cap." } }              // UI offers NO sign button
{ "type": "portfolio_snapshot", "positions": [ /* PositionLite */ ] }
{ "type": "tip", "topic": "what_is_apy", "body": "..." }                              // literacy (FR-007)
{ "type": "outcome", "recId": "rec_01H...", "realizedPnlUsd": "12.40", "status": "open" }
{ "type": "citation", "sources": [ /* Citation */ ] }
{ "type": "error", "code": "REFUSAL", "message": "..." }
```

A `recommendation`/`action` block is **signable only if** `policy.status == "approved"`. Otherwise the renderer hides/disables the action and shows `policy.reason`. Structured action/recommendation blocks are emitted as **complete JSON** (never partially streamed) so a half-streamed action can't be acted on. Only `text` and `tool_step` stream incrementally.

---

## 3. Endpoints

### 3.1 Onboarding / Mandate

#### `POST /onboarding/turn` — drive the chat-driven onboarding step machine
Stateful onboarding conversation that produces a **draft** mandate. The mandate is NOT persisted until explicitly confirmed (FR-002).

- **Stream:** `text/event-stream` of `ChatBlock`s (same envelope as chat).
- **Request:**
```jsonc
{
  "sessionId": "onb_01H...",          // server-issued on first turn; omit to start new
  "step": "risk_scenario",            // welcome|connect|experience|goals|timeline|risk_scenario|review
  "userMessage": "I'd hold and wait it out.",
  "selections": { "scenario": "hold", "experience": "intermediate" }
}
```
- **Response (stream):** onboarding `ChatBlock`s; the final block of a completed flow is a `mandate_draft`:
```jsonc
{ "type": "mandate_draft", "mandate": {
    "goals": [ { "kind": "grow_savings", "label": "Grow my savings safely" } ],
    "riskProfile": "conservative",
    "riskParams": { "maxSlippageBps": 50, "drawdownTolerance": "low", "horizonMonths": 12 },
    "summaryText": "Conservative, capital-preservation focus; USDC yield via the 0-management, profit-only performance-fee vault (10% of yield, 0% on principal).",
    "version": 1
} }
```
- **Errors:** `VALIDATION_ERROR`, `BETA_NOT_ENABLED`, `GEO_BLOCKED`, `UPSTREAM_UNAVAILABLE`, `REFUSAL`.

#### `POST /mandate` — persist a confirmed mandate (FR-002)
- **Request:** `{ "mandate": { /* the confirmed mandate_draft body */ } }`
- **Response 201:**
```jsonc
{ "mandate": { "id": "mnd_01H...", "version": 1, "active": true, "confirmedAt": "2026-06-15T12:00:00Z", /* ...fields */ } }
```
- **Errors:** `VALIDATION_ERROR`, `UNAUTHENTICATED`.

#### `GET /mandate` — read the active mandate
- **Response 200:** `{ "mandate": { /* active mandate, or null */ } }`
- **Errors:** `NOT_FOUND` (no mandate yet → 200 with `null` preferred).

#### `PUT /mandate` — update goals/risk (creates a new versioned row, FR-004)
- **Request:** `{ "mandate": { /* updated fields */ } }`
- **Response 200:** `{ "mandate": { "id": "...", "version": 2, "active": true } }` (prior version retained, inactive).

---

### 3.2 Chat turn (streamed, with tool-steps)

#### `POST /chat` — primary conversational surface (SSE)
- **Headers:** `Accept: text/event-stream`.
- **Request:**
```jsonc
{
  "conversationId": "cnv_01H...",       // omit to start; echoed back
  "message": "Where can I earn safe yield on my USDC?",
  "context": { "surface": "chat" },     // surface ∈ chat | strategy | vault | portfolio (hints UI intent)
  "clientTime": "2026-06-15T12:00:00Z"
}
```
- **Response:** `200 text/event-stream`. SSE events are `ChatBlock`s (§2.7). Order is typically: `tool_step`(running) → `tool_step`(done) → `text`/`recommendation`/`tip`/`citation` blocks. `tool_step` blocks surface the visible reasoning trace (Claude adaptive thinking, summarized — never raw chain-of-thought).
- **SSE framing:**
```
event: block
data: {"type":"tool_step","label":"Reading your portfolio","status":"running"}

event: block
data: {"type":"recommendation","recId":"rec_01H...","rank":1, ...}

event: done
data: {"conversationId":"cnv_01H...","blockCount":7}
```
- **Important:** `/chat` NEVER returns a signable bundle. A `recommendation`/`action` block carries only a `ProposedAction` + `policy` stamp; the user must call `/build-tx` (§3.5) to materialize an `IntentBundle`, and sign in the `ExecutionDrawer`. (Single signing chokepoint.)
- **Errors (as `error` ChatBlock or pre-stream non-2xx):** `REFUSAL`, `UPSTREAM_UNAVAILABLE`, `RATE_LIMITED`, `DATA_STALE` (degrades: derived blocks marked stale), `BETA_NOT_ENABLED`, `GEO_BLOCKED`.

#### `POST /chat/feedback` — thumbs feedback (FR feedback signal)
- **Request:** `{ "conversationId": "...", "blockId": "...", "rating": "up" }` (`up`|`down`).
- **Response 204.**

---

### 3.3 Portfolio read

#### `GET /portfolio` — enriched, derived portfolio (stale-markable)
Derived/enriched data only (PnL history, allocation). Custody-critical balances are read by the frontend via **direct RPC** and reconciled against this (SC-011); this endpoint is allowed to be `stale`/unavailable without blocking deposit/withdraw.

- **Query:** `?include=positions,pnl,allocation,risk` (comma list; default all).
- **Response 200:**
```jsonc
{
  "asOfBlock": 0, "asOf": "...", "stale": false,
  "netWorthUsd": "12345.67",
  "positions": [
    { "venue": "vault", "asset": "0xUSDC", "shares": "98765432",
      "underlying": "100250000", "valueUsd": "100.25", "priceSource": "chainlink",
      "costBasisUsd": "100.00", "unrealizedPnlUsd": "0.25", "riskTier": "conservative" }
  ],
  "allocation": { "byAsset": [ /* ... */ ], "byStrategy": [ /* ... */ ], "byRiskTier": [ /* ... */ ] },
  "pnl": { "series": [ { "ts": "...", "valueUsd": "..." } ], "realizedUsd": "...", "unrealizedUsd": "..." },
  "risk": { "score": 18, "concentrationBps": 9800, "drift": "low" },
  "dataSources": [ { "source": "alchemy", "status": "ok", "lastBlock": 0 },
                   { "source": "dune", "status": "stale", "lastOkAt": "..." } ]
}
```
- **Errors:** `DATA_STALE` (returns 200 with `stale:true` preferred over hard error so UI degrades), `UPSTREAM_UNAVAILABLE`.

#### `GET /portfolio/positions/{positionId}` — single position detail
- **Response 200:** one enriched position + its `onchain_events` history + per-position PnL series.
- **Errors:** `NOT_FOUND`.

---

### 3.4 Strategy recommendations

#### `GET /recommendations` — ranked strategies vs. the user's mandate (FR-014, SC-005)
- **Query:** `?limit=5&refresh=false`. `refresh=true` forces a recompute via the recommender agent.
- **Response 200:**
```jsonc
{
  "policyVersion": "policy@2026.06.0",
  "mandateVersion": 1,
  "recommendations": [
    {
      "recId": "rec_01H...",
      "rank": 1,
      "strategyKind": "vault_deposit",
      "title": "Deposit USDC into the 0-management, profit-only Aave Yield Vault",
      "protocol": "aave_v3",                  // ∈ aave_v3 | aerodrome (whitelist ONLY; FR-016)
      "rationale": "Matches your conservative, capital-preservation mandate; gross Aave APY 4.21%, ~3.79% net of the 10% profit-only performance fee (0% on principal).",
      "proposedAction": { /* ProposedAction §2.x — NOT yet a signable bundle */ },
      "policy": { "status": "approved", "checks": [ /* GuardrailCheck */ ] },
      "citations": [ /* Citation */ ],
      "grossApyBps": 421,                     // pre-fee Aave supply APY
      "projectedApyBps": 379,                 // net of the 10% profit-only performance fee (applied to yield only)
      "performanceFeeBps": 1000,              // current rate; profit-only, HWM, hard-capped at 2000 (20%)
      "asOf": "...", "stale": false
    }
  ]
}
```
- **Notes:** Only whitelisted protocols ever appear (the renderer shows nothing the policy layer hasn't cleared, FR-016/SC-006). Recommendations are advisory; they become signable only via `/build-tx`.
- **Errors:** `NOT_FOUND` (no mandate → prompt onboarding), `DATA_STALE` (200 + `stale:true`), `UPSTREAM_UNAVAILABLE`, `REFUSAL`.

#### `GET /recommendations/{recId}` — "why this?" detail + compare
- **Response 200:** the recommendation plus expanded rationale, full citation set, and a `comparison[]` against neighboring ranks.
- **Errors:** `NOT_FOUND`.

---

### 3.5 Build transaction (UNSIGNED + simulated + guardrail-checked)

#### `POST /build-tx` — materialize an `IntentBundle` for a proposed action
The single endpoint that turns a `ProposedAction` (from a recommendation or a direct chat command) into a signable-by-the-user bundle. **It returns ONLY unsigned calldata + simulation + verdict.** It never returns a signature and never submits. (N1, N3, FR-008, FR-022)

- **Request:**
```jsonc
{
  "action": {
    "type": "vault_deposit",              // ActionType §2.2
    "asset": "0xUSDC", "decimals": 6,
    "amount": "100000000",                // base units, OR "byShares" for redeem
    "params": { "maxSlippageBps": 50 },   // swaps: required; honored as amountOutMin floor
    "recommendationId": "rec_01H..."      // optional; links outcome log
  },
  "execMode": "per_action"                // per_action (default, owner sig) | session_key
}
```
- **Behavior (server, ordered, fail-closed):**
  1. Schema/shape validity → else `VALIDATION_ERROR`.
  2. Deterministic policy `evaluate(action, context)`: protocol allowlist (address-level), asset allowlist, **recipient forced to `X-Account`/`X-Owner`**, mandate conformance, caps (deposit-side), kill-switch branch (withdraws skip pause).
  3. Build unsigned calldata / `PackedUserOperation` (factory+factoryData if account counterfactual). `signature` left `null`.
  4. Tenderly `simulate` (fresh) → balance deltas, shares/assets/out, slippage, revert.
  5. Re-assert: not revert, slippage ≤ user max, caps ok, data fresh.
  6. On full pass → return `IntentBundle` (`policyVerdict.approved=true`). On any failure → error envelope with `reasons[]`, **no bundle**.
- **Response 200:** `{ "intentBundle": { /* IntentBundle §2.1 */ } }`
- **Errors:** `POLICY_REJECTED`, `CAP_EXCEEDED`, `SLIPPAGE_EXCEEDED`, `SIMULATION_REVERT`, `SIMULATION_UNAVAILABLE` (swaps fail-closed; vault/Aave may fall back to local dry-run), `DATA_STALE`, `KILL_SWITCH_PAUSED` (deposits/deploys only — **never** for `vault_withdraw`/`vault_redeem`/`aave_withdraw`), `VALIDATION_ERROR`.

#### `POST /simulate` — standalone re-simulation (preview refresh)
Proxies Tenderly for an already-built bundle whose `expiresAt` is near, or to preview without committing.
- **Request:** `{ "intentId": "intent_01H..." }` or `{ "steps": [ /* unsigned steps */ ] }`.
- **Response 200:** `{ "simulation": { /* SimulationResult */ } }`
- **Errors:** `SIMULATION_REVERT`, `SIMULATION_UNAVAILABLE`, `NOT_FOUND`, `DATA_STALE`.

---

### 3.6 Submit signed transaction

#### `POST /submit-signed-tx` — relay a USER-SIGNED artifact to bundler/RPC (convenience relay)
The frontend MAY submit directly (its own bundler/RPC path is the default and preserves N2 independence). This endpoint exists as a convenience relay so the service can correlate the resulting tx hash for outcome logging. **The service does not and cannot sign; it only forwards a payload the user already signed and watches for the receipt.**

- **Request:**
```jsonc
{
  "intentId": "intent_01H...",
  "signed": {
    "opType": "userop",                       // userop | eoa_call
    "userOp": { /* PackedUserOperation with signature NON-null — supplied BY THE WALLET */ },
    "rawTx": null                             // for opType=eoa_call: 0x-prefixed signed raw tx
  }
}
```
- **Validation:** the service asserts the signed payload's `sender`/`callData`/`to`/`data` **byte-match the unsigned `IntentBundle` it issued** (`intentId`). Any divergence → `VALIDATION_ERROR` (prevents a tampered payload being attributed/relayed). It does NOT re-sign or alter the payload.
- **Response 202:**
```jsonc
{ "submission": { "intentId": "intent_01H...", "status": "pending",
  "userOpHash": "0x...", "txHash": null, "bundler": "alchemy" } }
```
- **Outcome logging:** on confirmation, the service writes the `outcome_log` row linking `recommendationId → txHash` with the entry snapshot (FR-039), keyed by the `intentId`/`IntentLog`.
- **Errors:** `VALIDATION_ERROR` (payload mismatch / signature null), `NOT_FOUND` (unknown intent), `UPSTREAM_UNAVAILABLE` (bundler/RPC). **Never** `KILL_SWITCH_PAUSED` for a withdraw/redeem payload.

#### `GET /submit-signed-tx/{intentId}` — poll submission status
- **Response 200:** `{ "status": "confirmed", "txHash": "0x...", "blockNumber": 0, "receipt": { /* lite */ } }` (`status` ∈ `pending`|`confirmed`|`failed`).

---

### 3.7 Vault deposit/withdraw quote

These are **read/preview** helpers. They are ERC-4626-accurate (mirror `previewDeposit`/`previewMint`/`previewWithdraw`/`previewRedeem`). They never move funds; withdraw quotes are convenience-only and their absence never blocks the on-chain escape hatch (N2).

> **Rounding always favors the vault (against the user)** to protect existing depositors — this is standard EIP-4626: `previewDeposit`/`convertToShares` and `previewRedeem`/`convertToAssets` round **DOWN**, while `previewMint`/`previewWithdraw` round **UP**.

#### `POST /vault/quote/deposit` — deposit/mint preview + caps meter
- **Request:** `{ "by": "assets", "amount": "100000000" }` (`by` ∈ `assets`|`shares`).
- **Response 200:**
```jsonc
{
  "by": "assets",
  "assets": "100000000",
  "shares": "98765432",                 // previewDeposit(assets) — rounds DOWN, in the vault's favor
  "grossApyBps": 421,                   // pure Aave supply APY, cross-checked vs on-chain rate (before perf fee)
  "netApyBps": 379,                     // net-of-EVERYTHING projection = grossApy × (1 - performanceFeeBps/10000) on yield only
  "performanceFee": {                   // profit-only fee; 0% on principal, 0% management/entry/exit
    "rateBps": 1000,                    // current on-chain performanceFeeBps; default 1000 (10%)
    "maxRateBps": 2000,                 // hard cap (20%) — governance can never exceed; timelocked + multisig-bounded
    "base": "realized_yield_above_hwm", // charged ONLY on yield above the high-water mark; NEVER on principal
    "managementBps": 0, "entryBps": 0, "exitBps": 0, "principalBps": 0,
    "highWaterMark": "1.0423",          // current share-price HWM (assets-per-share); fee accrues only above this
    "active": true,                     // ACTIVE AT LAUNCH (Sept 2026 v1) on the Aave Yield Vault
    "disclosure": "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal. We only earn when you earn — never on your principal, never by taking custody.",
    "provableOnchain": true             // performanceFeeBps()/highWaterMark()/feeRecipient() are public-view (N5)
  },
  "caps": {
    "perUserRemaining": "4900000000", "totalRemaining": "...", "vaultRemaining": "...",
    "maxDeposit": "4900000000",         // ERC-4626 maxDeposit(receiver) = min(...) ; 0 when at cap
    "wouldBreach": false
  },
  "asOfBlock": 0, "stale": false
}
```
- **Notes:** `netApyBps` is the net-of-fee projection the UI shows by default; `grossApyBps` is the pre-fee Aave rate. The performance fee reduces only the **yield** leg (profit-only), so principal projections are unaffected. The fee is fully disclosed pre-deposit (the `disclosure` string is rendered verbatim) and is provable on-chain.
- **Errors:** `CAP_EXCEEDED` (echoed via `wouldBreach:true` + 200 preferred so UI blocks pre-sign, FR-025/SC-009), `DATA_STALE`, `KILL_SWITCH_PAUSED` (deposit is pausable; surfaced so UI can disable deposit while keeping withdraw open).

#### `POST /vault/quote/withdraw` — withdraw/redeem preview (NEVER cap-, pause-, or fee-gated)
- **Request:** `{ "by": "shares", "amount": "98765432" }` (`by` ∈ `assets`|`shares`).
- **Response 200:**
```jsonc
{
  "by": "shares",
  "shares": "98765432",
  "assets": "100250000",                // previewRedeem(shares) — rounds DOWN, in the vault's favor; ALREADY net of fee-share dilution
  "principalUsd": "100.00",             // deposited principal — NEVER reduced by the performance fee
  "accruedYieldUsd": "0.25",            // realized yield in this position
  "performanceFee": {                   // profit-only; applied as fee-SHARE dilution, already reflected in `assets`
    "rateBps": 1000, "maxRateBps": 2000,
    "base": "realized_yield_above_hwm", // 0% on principal; 0 when at/below the HWM (flat/down periods)
    "highWaterMark": "1.0423",          // current share-price HWM
    "estFeeOnYieldUsd": "0.00",         // est. fee attributable to THIS exit's yield-above-HWM (0 here: at/below HWM)
    "netYieldUsd": "0.25",              // accruedYield net of the performance fee
    "disclosure": "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal.",
    "doesNotGateWithdraw": true         // fee accrual is FAIL-OPEN on-chain — it can NEVER block/delay your exit (N2)
  },
  "maxWithdraw": "100250000", "maxRedeem": "98765432",
  "note": "Withdrawals are never blocked by caps, the kill-switch, or fee accrual (N2). The performance fee is profit-only (0% on your principal) and is taken as share dilution, never by holding back your assets. You can also exit directly on-chain.",
  "exitHatchUrl": "/exit",
  "asOfBlock": 0, "stale": false
}
```
- **Notes:** the returned `assets` is the ERC-4626 `previewRedeem` value, which is **already net** of any fee-share dilution — there is no extra deduction at withdraw time and no fee is ever withheld from the transfer. The fee is profit-only: `principalUsd` is never reduced, and `estFeeOnYieldUsd` is `0` whenever share price is at/below the HWM. On-chain the fee accrual is FAIL-OPEN, so it can never gate the exit.
- **Errors:** `DATA_STALE` (200 + `stale:true`; quote may be approximate). **MUST NOT** return `KILL_SWITCH_PAUSED` or `CAP_EXCEEDED`. If the service is fully down, the frontend computes this from direct RPC.

---

### 3.8 Outcome log

#### `GET /outcomes` — realized/unrealized PnL per recommendation (FR-039–041, SC-010)
- **Query:** `?status=open,closed&since=...&limit=50`.
- **Response 200:**
```jsonc
{
  "outcomes": [
    {
      "id": "out_01H...",
      "recommendationId": "rec_01H...",     // null => user-initiated, unattributed
      "strategyKind": "vault_deposit",
      "resultingTxs": ["0x..."],
      "entryBlock": 0, "entryTs": "...", "entryValueUsd": "100.00",
      "realizedPnlUsd": "0.00", "unrealizedPnlUsd": "0.25",
      "pnlAsOfBlock": 0, "status": "open",
      "attributionMethod": "intent_log",     // intent_log | heuristic_match | unmatched
      "label": null,                         // win | loss | risk_event (set on maturity)
      "reconstructable": true                // every figure replayable from chain + pinned price snapshot
    }
  ]
}
```
- **Errors:** `DATA_STALE`, `UPSTREAM_UNAVAILABLE`.

#### `GET /outcomes/{recId}` — outcome detail for one recommendation
- **Response 200:** the outcome with its `entry_price_snapshot`, per-tx breakdown, and the rationale it was created from.
- **Errors:** `NOT_FOUND`.

---

### 3.9 Vault / Aave session-key automation (grant / revoke) — opt-in only (N4)

These endpoints **build** the user-signed UserOps that register/revoke a session key on-chain. The service holds the session **public** key it will later sign rebalances with, but that key has **zero standing authority** — it is bounded entirely by the on-chain `PolicyModule`. Granting and revoking are themselves user-signed; revocation is unilateral and does not depend on the service.

#### `POST /session-keys/grant/build` — build the grant UserOp (user signs)
- **Request:**
```jsonc
{
  "scope": {
    "allowlist": ["vault.deposit", "vault.withdraw", "aave.supply", "aave.withdraw", "aerodrome.swap"],
    "perTxCap": "500000000",            // USDC 6dp
    "cumulativeCap": "5000000000",
    "maxSlippageBps": 50,
    "validUntil": "2026-07-15T00:00:00Z"   // HARD expiry
  }
}
```
- **Behavior:** the service generates a fresh session keypair (it holds only the key it will sign rebalances with — never a user key), then returns an UNSIGNED UserOp calling `account.authorizeSessionKey(Policy{...})`. The displayed scope is **verbatim** the on-chain `Policy` shape so on-chain == displayed (FR-029, N4).
- **Response 200:**
```jsonc
{
  "intentBundle": { /* IntentBundle, kind: session_key_grant, unsigned */ },
  "sessionKey": "0x<sessionPubKey>",     // PUBLIC key only
  "scopeEcho": { /* normalized on-chain Policy struct the user is authorizing */ }
}
```
- **Errors:** `POLICY_REJECTED` (scope exceeds allowed bounds, e.g. non-allowlisted target, slippage above floor), `VALIDATION_ERROR`, `KILL_SWITCH_PAUSED` (new session-key activation is pausable; revoke is not).

#### `POST /session-keys/revoke/build` — build the revoke UserOp (user signs, unilateral)
- **Request:** `{ "sessionKey": "0x<sessionPubKey>" }`
- **Behavior:** returns an UNSIGNED UserOp calling `account.revokeSessionKey(sessionKey)` (owner-only). **This path never depends on the agent and is never pause-gated** — revocation must always be possible (N4, FR-031, SC-008). The frontend may also build this entirely client-side; this endpoint is convenience only.
- **Response 200:** `{ "intentBundle": { /* IntentBundle, kind: session_key_revoke, unsigned */ } }`
- **Errors:** `VALIDATION_ERROR`, `NOT_FOUND`. **Never** `KILL_SWITCH_PAUSED`.

#### `GET /session-keys` — list the user's active/expired session keys (read; chain is source of truth)
- **Response 200:**
```jsonc
{
  "sessionKeys": [
    {
      "sessionKey": "0x...", "status": "active",        // active | expired | revoked
      "scope": { "allowlist": [...], "perTxCap": "...", "cumulativeCap": "...", "spent": "1200000000",
                 "maxSlippageBps": 50, "validUntil": "2026-07-15T00:00:00Z" },
      "remaining": { "cumulative": "3800000000" },
      "asOfBlock": 0
    }
  ],
  "note": "Authoritative scope is on-chain in PolicyModule; these values are read from chain."
}
```
- **Errors:** `DATA_STALE`, `UPSTREAM_UNAVAILABLE`.

---

### 3.10 Trust / permissions (provable non-custody, read-only)

These mirror what the frontend `/trust/permissions` panel reads **directly from chain via Viem**. The agent service version is a convenience aggregation; the frontend's "prove-it" panel reads chain directly and never depends on this (SC-004, SC-012, FR-037). Always labeled with `asOfBlock` so figures are reproducible.

#### `GET /trust/permissions` — exact on-chain permissions for the user's account, vault, sessions
- **Response 200:**
```jsonc
{
  "asOfBlock": 0, "asOf": "...",
  "account": {
    "address": "0x<smartAccount>",
    "owner": "0x<ownerEoa>",              // == X-Owner; sole admin signer (N3)
    "validators": ["0x<sessionKeyValidator>"],
    "activeSessionKeys": [ /* as §3.9 list */ ]
  },
  "vault": {
    "address": "0x<vault>",
    "asset": "0xUSDC",
    "upgradeable": false,                 // non-upgradeable; no proxy/EIP-1967 slots (N5)
    "paused": false,                      // PAUSE-ONLY; withdrawals never blocked
    "guardian": "0x<multisig>",           // pause/unpause ONLY — no fund-movement selector
    "pauser": "0x<multisig>",
    "fees": {                             // read straight from chain (public-view; N5 provable)
      "entryBps": 0, "exitBps": 0, "managementBps": 0,  // 0 at bytecode level (pure constants)
      "performance": {
        "rateBps": 1000,                  // performanceFeeBps(); default 10%
        "maxRateBps": 2000,               // MAX_PERFORMANCE_FEE_BPS() — hard cap (20%), timelocked + multisig-bounded
        "base": "realized_yield_above_hwm",
        "highWaterMark": "1.0423",        // highWaterMark(); fee accrues only above this
        "feeRecipient": "0x<recipient>",  // ORDINARY, non-privileged share holder; no power over other users' funds
        "failOpenOnWithdraw": true        // accrual can NEVER block/delay a withdraw (N2)
      }
    }
  },
  "caps": { "perUser": "5000000000", "total": "...", "vaultDeposit": "...", "perUserCeiling": "..." },
  "killSwitch": { "paused": false, "scope": "PAUSE_ONLY", "blocksWithdrawals": false },
  "allowlist": [ { "protocol": "aave_v3", "target": "0x<aavePool>" },
                 { "protocol": "aerodrome", "target": "0x<router>" } ],
  "canDo": [ "Direct strategy within the allowlist (Aave v3, Aerodrome)",
             "Pause NEW deposits (kill-switch)",
             "Set the performance-fee rate within [0, 20%] via timelock + multisig (profit-only; affects only FUTURE yield-above-HWM)" ],
  "cannotDo": [ "Withdraw your funds to a SparkPoint address (no such code path — N1)",
                "Block your withdrawal (N2)",
                "Charge a fee on your principal, or any fee in flat/down periods (performance fee is profit-only, above a high-water mark)",
                "Set the performance fee above the 20% hard cap, or use it to touch principal/custody/withdraw",
                "Block or delay your withdrawal via fee accrual (accrual is FAIL-OPEN — N2)",
                "Upgrade or alter the vault's custody semantics (N5)",
                "Exceed your session-key scope (N4)" ],
  "links": { "vaultBaseScan": "https://basescan.org/address/0x...", "policyVersion": "policy@2026.06.0" }
}
```
- **Errors:** `UPSTREAM_UNAVAILABLE` (frontend then falls back to direct RPC and still renders the panel).

#### `GET /trust/status` — Trust Center hub aggregate (caps utilization, kill-switch, whitelist)
- **Response 200:** caps dashboard (per-user/total/vault live from RPC), `killSwitch` labeled `PAUSE_ONLY` with "withdrawals never blocked", whitelisted-protocols list, self-custody guarantees panel data, audit/risk badges. All values stamped `asOfBlock`.
- **Errors:** `UPSTREAM_UNAVAILABLE`.

---

## 4. Endpoint → flow / invariant traceability

| Endpoint | Core flow | FR / SC | Invariant |
|---|---|---|---|
| `POST /onboarding/turn`, `POST/GET/PUT /mandate` | Onboarding → Mandate | FR-001–004 | — |
| `POST /chat`, `POST /chat/feedback` | Chat assistant | FR-005–008 | G1 |
| `GET /portfolio`, `/portfolio/positions/{id}` | Portfolio overview | FR-009–013, SC-011 | N2 (read degrades, withdraw unaffected) |
| `GET /recommendations`, `/recommendations/{recId}` | Strategy recommendations | FR-014–016, SC-005/006 | G5 |
| `POST /build-tx`, `POST /simulate` | Execution confirmation (build) | FR-008/021/023, SC-002/006 | N1, N3, G1, G4 |
| `POST /submit-signed-tx`, `GET /submit-signed-tx/{id}` | Execution confirmation (submit) | FR-022, SC-001 | N3 (user signs) |
| `POST /vault/quote/deposit` | Vault deposit | FR-025, SC-009 | caps, G2 |
| `POST /vault/quote/withdraw` | Vault withdraw | FR-026, SC-003 | **N2** |
| `GET /outcomes`, `/outcomes/{recId}` | Outcome log | FR-039–041, SC-010 | N5 (reconstructable) |
| `POST /session-keys/grant/build` | Automation opt-in | FR-029/030/036 | **N4** |
| `POST /session-keys/revoke/build`, `GET /session-keys` | Automation revoke/manage | FR-031/032, SC-008 | **N4** (unilateral) |
| `GET /trust/permissions`, `/trust/status` | Trust Center | FR-037/038, SC-004/012 | **N5**, N1 |

---

## 5. Failure-mode summary (service degraded → behavior)

| Condition | API behavior | Custody/withdraw impact |
|---|---|---|
| Claude error / refusal / timeout | `REFUSAL`/`UPSTREAM_UNAVAILABLE`; no `IntentBundle`; safe fallback text | none |
| Tenderly down | swaps fail-closed (`SIMULATION_UNAVAILABLE`); vault/Aave custody ops may local-dry-run | none |
| Dune/DeFiLlama/subgraph down | citations `stale`; derived reads return `stale:true`; execution on stale data blocked (`DATA_STALE`) | none |
| Kill-switch paused | deposits/grants → `KILL_SWITCH_PAUSED`; **withdraw/redeem/revoke unaffected** | **withdraw still works** |
| Entire agent service offline | frontend uses direct RPC for portfolio/vault/trust; `/exit` builds withdraw client-side | **withdraw still works (N2)** |

**Net:** every state-changing response is (a) typed, (b) deterministically policy-validated, (c) simulated, and (d) emitted only as inert **unsigned** calldata the user signs in their own wallet — and no failure of this service can move, trap, or block a user's funds.
