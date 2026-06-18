# Contract: Deterministic Policy / Guardrail Schema

**Feature:** 001-sparkpoint-pivot-mvp · **Chain:** Base (`8453`) / Base Sepolia (`84532`).
**Status:** Phase 1 contract. This schema is the **single source of truth** honored by BOTH:
- the **off-chain deterministic policy layer** (`policy/`, pure Python, LLM-free, in the AI Orchestration Layer), and
- the **on-chain `PolicyModule` / `SessionKeyValidator`** (the final backstop).

It is also surfaced read-only by the Trust Center. Caps, slippage, and the protocol allowlist are **defined once** in `packages/shared` (`policy constants`) and consumed by both the off-chain layer and the on-chain deploy script so the two **can never drift**.

---

## 0. Design contract (READ FIRST)

1. **Two enforcers, one schema, on-chain is authoritative.** The off-chain layer ensures the user is never even *shown* a signable out-of-policy action (fail-closed UX). The on-chain module is the defense-in-depth backstop that holds even if the off-chain layer is bypassed or malicious. **If they disagree, the chain wins** (the tx reverts; the simulation gate catches it first to save gas).
2. **No drift by construction.** Allowlist addresses, caps, slippage floors, and selectors are derived from the same versioned constant set (`policyVersion`). Off-chain reads them from `packages/shared`; on-chain seeds them from the same values at deploy. A mismatch is a CI failure.
3. **Address+selector level, never name level.** The allowlist is keyed by `(target address, 4-byte selector)`. "Aave is allowed" is never enough — only specific Pool/Router/vault selectors pass. Arbitrary `call` and ERC-20 `approve` are NEVER allowlisted for session keys.
4. **Fail-closed, ordered evaluation.** Unknown/malformed/over-limit ⇒ reject with a structured reason; never a silent pass.
5. **Withdrawals are sacred (N2).** No rule in this schema — cap, pause, slippage, mandate — may ever block a withdraw/redeem/revoke. Every gate carries an explicit withdraw branch.
6. **The policy layer never depends on fuzzy state.** No LLM output, no embeddings/memory, no cache feed a verdict. Inputs are the action, fresh chain reads, a fresh simulation, and pinned constants.
7. **Recipient is pinned.** Every fund-moving action's recipient is forced to the user's own account/owner; no SparkPoint or arbitrary external recipient can ever be named (N1).

---

## 1. Versioning

```jsonc
{ "policyVersion": "policy@2026.06.0" }   // pinned; logged with every verdict, outcome, and Trust Center read
```
- `policyVersion` is a monotonic, human-readable tag (`policy@YYYY.MM.N`).
- It is logged in `policy_evaluations` (off-chain audit) and stamped on every `PolicyVerdict`, `IntentBundle`, and recommendation, so the Trust Center can state exactly which ruleset was in force (N5).
- On-chain, the active constant set is identified by the deployed `PolicyModule` address + the `CapRegistry` params; the off-chain `policyVersion` pins to that deployment.

---

## 2. Canonical enums

### 2.1 `Protocol`
`aave_v3` · `aerodrome` · `sparkpoint_vault`. (Whitelist is closed at launch — G5. Anything else is unreachable.)

### 2.2 `Asset` (launch set)
`USDC` · `ETH` (Aave path; ETH via WETH gateway). **Vault deposit asset == USDC only.**

### 2.3 `ActionType`
`vault_deposit` · `vault_withdraw` · `vault_redeem` · `aave_supply` · `aave_withdraw` · `aerodrome_swap` · `session_key_grant` · `session_key_revoke`.

### 2.4 `Direction`
`inflow` (deposit/supply/grant — **cap- and pause-gated**) · `outflow` (withdraw/redeem/swap-out) · `exit` (`vault_withdraw`/`vault_redeem`/`aave_withdraw`/`session_key_revoke` — **NEVER cap- or pause-gated**, N2).

### 2.5 `RiskProfile` (launch: conservative only; field reserved for forward-compat)
`conservative` (launch default) · `balanced` · `growth`.

### 2.6 Reason codes (returned in `reasons[]` on rejection)
`OK` · `SCHEMA_INVALID` · `PROTOCOL_NOT_ALLOWLISTED` · `SELECTOR_NOT_ALLOWLISTED` · `ASSET_NOT_ALLOWLISTED` · `RECIPIENT_NOT_USER` · `CAP_PER_USER_EXCEEDED` · `CAP_TOTAL_EXCEEDED` · `CAP_VAULT_EXCEEDED` · `CAP_PER_TX_EXCEEDED` · `CAP_CUMULATIVE_EXCEEDED` · `MANDATE_RISK_EXCEEDED` · `SLIPPAGE_EXCEEDED` · `MIN_OUT_BELOW_FLOOR` · `SIM_REVERT` · `SIM_UNAVAILABLE` · `DATA_STALE` · `KILL_SWITCH_PAUSED` · `SESSION_EXPIRED` · `SESSION_REVOKED`.

---

## 3. The allowlist (G5) — `(target, selector)` grammar

The allowlist is a closed set of `(protocol, target address, selector, asset constraints)` tuples. **One entry per permitted entrypoint.** Off-chain matches by decoded calldata; on-chain `PolicyModule.isAllowedTarget(target, selector)` matches the same `(target, selector)`.

```jsonc
{
  "policyVersion": "policy@2026.06.0",
  "chainId": 8453,
  "allowlist": [
    {
      "protocol": "sparkpoint_vault",
      "target": "0x<vault>",
      "selector": "0x6e553f65",          // deposit(uint256,address)
      "action": "vault_deposit",
      "direction": "inflow",
      "assets": ["USDC"],
      "recipientMustBe": "user_account",  // receiver param forced to the user's SparkPointAccount
      "capGated": true, "pauseGated": true
    },
    {
      "protocol": "sparkpoint_vault",
      "target": "0x<vault>",
      "selector": "0xba087652",          // redeem(uint256,address,address)
      "action": "vault_redeem",
      "direction": "exit",
      "assets": ["USDC"],
      "recipientMustBe": "user_account",
      "capGated": false, "pauseGated": false   // N2 — NEVER gated
    },
    {
      "protocol": "sparkpoint_vault",
      "target": "0x<vault>",
      "selector": "0xb460af94",          // withdraw(uint256,address,address)
      "action": "vault_withdraw",
      "direction": "exit",
      "assets": ["USDC"],
      "recipientMustBe": "user_account",
      "capGated": false, "pauseGated": false   // N2
    },
    {
      "protocol": "aave_v3",
      "target": "0x<aaveV3Pool>",
      "selector": "0x617ba037",          // supply(address,uint256,address,uint16)
      "action": "aave_supply",
      "direction": "inflow",
      "assets": ["USDC", "ETH"],          // ETH via WrappedTokenGatewayV3 entry (separate target/selector)
      "recipientMustBe": "user_account",  // onBehalfOf forced to account
      "capGated": true, "pauseGated": true
    },
    {
      "protocol": "aave_v3",
      "target": "0x<aaveV3Pool>",
      "selector": "0x69328dec",          // withdraw(address,uint256,address)
      "action": "aave_withdraw",
      "direction": "exit",
      "assets": ["USDC", "ETH"],
      "recipientMustBe": "user_account",  // `to` forced to account
      "capGated": false, "pauseGated": false   // N2
    },
    {
      "protocol": "aerodrome",
      "target": "0x<aerodromeRouter>",
      "selector": "0x...",               // swapExactTokensForTokens(uint256,uint256,Route[],address,uint256)
      "action": "aerodrome_swap",
      "direction": "outflow",
      "assets": ["USDC", "ETH"],
      "recipientMustBe": "user_account",  // `to` forced to account
      "slippageBound": true,              // amountOutMin must honor the slippage floor (§5)
      "routeFactoryMustBe": "0x<aerodromeFactory>",  // routes constrained to whitelisted factory/pools
      "capGated": true, "pauseGated": true
    }
  ],
  "explicitlyForbidden": {
    "selectors": ["0x095ea7b3 (approve)", "0x (arbitrary call)", "0xa9059cbb (transfer)", "transferFrom", "any upgrade/admin/sweep/rescue"],
    "rationale": "Session keys must never self-grant spend power, reach unknown code, or move funds to a non-user recipient (N1, N4)."
  }
}
```

**Rules:**
- A target/selector NOT in `allowlist` ⇒ `PROTOCOL_NOT_ALLOWLISTED` / `SELECTOR_NOT_ALLOWLISTED` (fail-closed).
- WETH-gateway ETH paths are **separate allowlist entries** (their own `target`/`selector`), not implied by the USDC entries.
- `recipientMustBe: "user_account"` is enforced off-chain (decode + assert) AND on-chain (the validator/adapter forces the recipient field) — belt and suspenders for N1.
- For Aerodrome, `Route[]` is constrained to the whitelisted `factory` and pools; any other factory ⇒ reject.

---

## 4. Caps (G2) — schema + semantics

```jsonc
{
  "caps": {
    "perUserTvlCap":   { "asset": "USDC", "amount": "5000000000",   "decimals": 6, "ceiling": "10000000000" },
    "totalProtocolCap":{ "asset": "USDC", "amount": "1000000000000","decimals": 6, "ceiling": "5000000000000" },
    "vaultDepositCap": { "asset": "USDC", "amount": "1000000000000","decimals": 6, "ceiling": "5000000000000" },
    "sessionPerTxCap": { "asset": "USDC", "amount": "500000000",    "decimals": 6 },
    "sessionCumulativeCap": { "asset": "USDC", "amount": "5000000000", "decimals": 6 }
  }
}
```

| Cap | Checked against | Enforced (authoritative on-chain) | Off-chain pre-check | Gates |
|---|---|---|---|---|
| `perUserTvlCap` | caller's vault position post-action | `Vault.maxDeposit` + `deposit` | yes (block pre-sign, FR-025) | **inflow only** |
| `totalProtocolCap` | `Vault.totalAssets()` aggregate | `CapRegistry.totalCap` vs `totalAssets()` | yes | **inflow only** |
| `vaultDepositCap` | `Vault.totalAssets()` | `Vault.depositCap` (immutable/param) | yes | **inflow only** |
| `sessionPerTxCap` | per-UserOp notional | `PolicyModule` in `validateUserOp` | yes (preview) | **session inflow/outflow** |
| `sessionCumulativeCap` | running `spent` + notional | `PolicyModule` (`spent` monotonic) | yes | **session inflow/outflow** |

**Semantics (normative):**
- All caps are **raw integer base units + `decimals`** (never floats).
- `ceiling` is the immutable hard maximum the multisig may set a cap *up to*; even a compromised multisig cannot exceed it. Caps default to fixed-at-deploy for non-custody clarity; if adjustable, only within `ceiling`, pause-only multisig, cap-param-only — never a fund path.
- **Caps NEVER gate exits.** `direction == "exit"` skips all cap checks. A withdraw may freely take a user/vault below any cap.
- Off-chain caps mirror the on-chain reads (read fresh from chain at decision time, never from cache) so the UX block matches the chain.
- ERC-4626 surfacing: `maxDeposit(receiver) = min(perUserRemaining, totalRemaining, vaultRemaining)` returns 0 at cap so standard tooling reflects it; `maxWithdraw`/`maxRedeem` are never reduced by caps.

### 4.1 Governance params (bounded, non-custody) — performance fee

The vault charges a **profit-only performance fee**: 0% management, 0% entry/exit, 0% on principal, and **10% on REALIZED YIELD ONLY** above a share-price high-water mark — **ACTIVE AT LAUNCH** (Sept 2026 v1). `performanceFeeBps` is the **only** mutable governance parameter beyond pause/caps. Like a cap `ceiling`, it is **hard-bounded by an immutable maximum the multisig can never exceed**, and it is a **non-custody** param: it can never alter custody/withdraw/principal semantics.

```jsonc
{
  "governanceParams": {
    "performanceFeeBps": {
      "amount": 1000,                      // current rate (10%); default at launch
      "ceiling": 2000,                     // IMMUTABLE hard cap (20%) — MAX_PERFORMANCE_FEE_BPS; multisig can never exceed
      "base": "realized_yield_above_hwm",  // charged ONLY on yield above the high-water mark — NEVER on principal
      "highWaterMark": true,               // share-price HWM; 0 fee in flat/down periods; prior losses re-earned first
      "managementBps": 0, "entryBps": 0, "exitBps": 0, "principalBps": 0,
      "mutable": true,
      "timelocked": true,                  // setPerformanceFeeBps is timelocked + multisig-bounded
      "custodyImpact": "none",             // cannot alter custody/withdraw/principal; only the FORWARD fee on FUTURE yield
      "gatesExit": false,                  // on-chain accrual is FAIL-OPEN — can NEVER block/delay a withdraw (N2)
      "active": true                       // live at launch on the Aave Yield Vault
    },
    "feeRecipient": {
      "kind": "ordinary_nonprivileged_holder",  // collects ONLY by redeeming its own fee shares via the normal withdraw/redeem path
      "mutable": true, "timelocked": true,
      "authorityOverOthers": "none"        // no admin/withdraw power over other holders; cannot block/reorder redemptions (N1)
    }
  }
}
```

**Semantics (normative):**
- The performance fee is realized by **minting fee shares** to `feeRecipient` for `performanceFeeBps × (yield above HWM)`, then advancing the HWM — **dilution only**, never an asset transfer, never a deduction from `totalAssets()` or principal (N1, N-fee).
- `performanceFeeBps` is settable **only within `[0, ceiling]`** by the timelocked, pause-only multisig; even a compromised multisig cannot exceed `ceiling (2000)` or reach a fund/custody path. It mirrors a cap's `ceiling` bounding (§4) — a non-custody governance param.
- **It NEVER gates exits.** On-chain accrual is FAIL-OPEN, so `direction == "exit"` (withdraw/redeem/revoke) is unaffected whether or not the fee accrues (N2). No new reason code is added — fee accrual can never produce a rejection.
- Off-chain mirrors `performanceFeeBps()`/`highWaterMark()`/`feeRecipient()`/`MAX_PERFORMANCE_FEE_BPS()` from chain (read fresh, never cached) for net-of-fee APY projection and pre-deposit disclosure; the values are provable on-chain (Trust Center).

---

## 5. Slippage (G4) — schema + semantics

```jsonc
{
  "slippage": {
    "userMaxSlippageBps": 50,          // from mandate.riskParams; per-user, per-action overridable downward
    "protocolFloorBps": 50,            // hard floor honored by session-key path (PolicyModule)
    "absoluteCeilingBps": 300,         // a user can never set a max above this for an automated swap
    "appliesTo": ["aerodrome_swap"]    // vault/Aave deposits & withdraws have NO oracle/slippage dependency
  }
}
```

**Semantics (normative):**
- Slippage applies ONLY to `aerodrome_swap`. **Vault deposit/withdraw and Aave supply/withdraw have no oracle/price dependency** — ERC-4626 share accounting derives from aToken balances, so the custody path cannot be price-manipulated.
- For a swap, the executor must set `amountOutMin = quote * (1 - userMaxSlippageBps/10_000)`, where `quote` comes from the pre-trade Tenderly simulation.
- **Off-chain gate:** reject (`SLIPPAGE_EXCEEDED`) if the simulated realized slippage > `userMaxSlippageBps`, or `MIN_OUT_BELOW_FLOOR` if `amountOutMin` is 0 or below `protocolFloorBps`.
- **On-chain gate (session path):** `SessionKeyValidator`/`PolicyModule` re-checks `amountOutMin >= floor(maxSlippageBps)`; the AMM itself reverts if min-out isn't met. We do NOT call an oracle inside `validateUserOp` (gas + manipulation surface + EntryPoint storage rules) — the embedded `amountOutMin` + the AMM + the user-facing sim together bound realized slippage.
- A user's chosen max is clamped to `[0, absoluteCeilingBps]` for automated swaps.

---

## 6. Session-key scope grammar (N4) — the `SessionScope` schema

This is the structure a user signs to authorize opt-in automation, displayed **verbatim** from the on-chain `Policy` shape so on-chain == displayed (FR-029). It maps 1:1 to `PolicyModule.Policy`.

```jsonc
{
  "sessionScope": {
    "sessionKey": "0x<sessionPubKey>",        // PUBLIC key the agent signs rebalances with; ZERO standing authority
    "validAfter": "2026-06-15T00:00:00Z",     // → uint48 timestamp
    "validUntil": "2026-07-15T00:00:00Z",     // HARD expiry (N4) → uint48; required, bounded by maxSessionDuration
    "perTxCap":      { "asset": "USDC", "amount": "500000000",  "decimals": 6 },
    "cumulativeCap": { "asset": "USDC", "amount": "5000000000", "decimals": 6 },
    "maxSlippageBps": 50,                      // ≤ absoluteCeilingBps; ≥ protocolFloorBps
    "allowlist": [                             // MUST be a subset of the global §3 allowlist
      "sparkpoint_vault.deposit",
      "sparkpoint_vault.withdraw",
      "aave_v3.supply",
      "aave_v3.withdraw",
      "aerodrome.swap"
    ],
    "recipientPin": "user_account",            // all recipients forced to the account — NEVER external/SparkPoint (N1)
    "revocable": true,                          // always true; owner-only, instant, unilateral
    "spent": "0"                                // on-chain running total (monotonic), read-only in UI
  },
  "bounds": {
    "maxSessionDurationDays": 30,              // validUntil - validAfter ≤ this
    "allowlistMustBeSubsetOfGlobal": true,
    "forbiddenSelectors": ["approve", "transfer", "transferFrom", "arbitrary call", "upgrade/admin/sweep"]
  }
}
```

**Grammar rules (normative, validated off-chain AND on-chain):**
1. `allowlist` entries MUST each be present in the §3 global allowlist; a session can only ever *narrow*, never widen. Out-of-subset ⇒ `SELECTOR_NOT_ALLOWLISTED` and the grant is rejected before it can be signed.
2. `validUntil` is **required**, must be in the future, and `validUntil - validAfter ≤ maxSessionDurationDays`. No "infinite" session.
3. `maxSlippageBps ∈ [protocolFloorBps, absoluteCeilingBps]`.
4. `perTxCap`, `cumulativeCap` ≤ their global session-cap ceilings (§4).
5. `recipientPin == "user_account"` is non-negotiable; the validator forces every recipient field to the account.
6. `approve`, `transfer`, `transferFrom`, arbitrary `call`, and any upgrade/admin/sweep selector are NEVER seedable — a session key cannot self-grant spend power or reach unknown code.
7. **Revocation** (`session_key_revoke`) is `direction: exit` — never cap- or pause-gated, owner-only, instant, unilateral, and does not route through or depend on the agent (FR-031, SC-008). After revoke, the next session UserOp fails `validateUserOp` (live-storage read).

---

## 7. Mandate conformance (forward-compat hook)

```jsonc
{
  "mandateConformance": {
    "maxRiskClass": "conservative",            // action.riskClass ≤ mandate.maxRiskClass
    "note": "At launch the allowlist already precludes non-conservative actions (only Aave v3 supply + 0-management profit-only-performance-fee vault + plain swaps). This hook is for forward-compat with multi-strategy."
  }
}
```
- Off-chain only at launch (the on-chain allowlist already constrains the action space). Reject ⇒ `MANDATE_RISK_EXCEEDED`. Memory/embeddings inform recommendations but **never** feed this verdict (the policy layer is deterministic).

---

## 8. `evaluate()` — the ordered, fail-closed decision procedure

Both enforcers run the same logical order. The off-chain layer runs all steps before showing a signable action; the on-chain module runs the subset expressible in `validateUserOp` (steps 1–5, 7) as the backstop.

```
evaluate(action, context) -> PolicyVerdict     # context = {fresh chain reads, fresh sim, pinned constants}

1. SCHEMA          action matches a known ActionType with well-typed fields     else → SCHEMA_INVALID
2. PROTOCOL        (target,selector) ∈ allowlist (address-level)                else → PROTOCOL/SELECTOR_NOT_ALLOWLISTED
3. ASSET           token ∈ allowlist.assets for this entry; vault asset == USDC else → ASSET_NOT_ALLOWLISTED
3b. RECIPIENT      recipient == user_account/owner (forced)                     else → RECIPIENT_NOT_USER
4. CAPS            if direction != exit: per-user, total, vault, per-tx,
                   cumulative all OK against projected post-action state        else → CAP_*_EXCEEDED
                   (exit → SKIP — N2)
5. MANDATE         action.riskClass ≤ mandate.maxRiskClass (off-chain hook)     else → MANDATE_RISK_EXCEEDED
6. SLIPPAGE/SIM    fresh Tenderly sim attached; !willRevert AND
                   slippage ≤ userMax AND amountOutMin ≥ floor                  else → SIM_REVERT / SLIPPAGE_EXCEEDED / MIN_OUT_BELOW_FLOOR
                   (sim unavailable: swaps fail-closed → SIM_UNAVAILABLE;
                    oracle-free custody ops may local-dry-run)
6b. FRESHNESS      every input citation.asOf within tolerance                   else → DATA_STALE  (custody/withdraw unaffected)
7. KILL-SWITCH     if action.direction == exit: SKIP (N2);
                   else if paused: reject                                       → KILL_SWITCH_PAUSED
8. SESSION (if session path) not revoked AND within [validAfter,validUntil]     else → SESSION_REVOKED / SESSION_EXPIRED

→ approved iff all applicable steps pass. Verdict carries policyVersion + simulation + normalizedAction.
```

**The explicit exit branch** (steps 4 & 7): `if action.direction == "exit": skip cap and pause checks`. This is the schema-level guarantee that nothing can ever block a withdraw/redeem/revoke (N2).

### Verdict shape (mirrors agent-service `PolicyVerdict`)
```jsonc
{
  "approved": true,
  "policyVersion": "policy@2026.06.0",
  "reasons": [ { "code": "OK", "message": "All checks passed." } ],
  "normalizedAction": { /* canonical calldata if approved; null if rejected */ },
  "simulation": { /* SimResult: balance deltas, fees, priceImpactBps, slippageBps, willRevert */ }
}
```
A rejected action returns to the user as an **explanation**, never as a signable bundle. `policyVersion` is logged with every evaluation for auditability and the Trust Center.

---

## 9. Off-chain ↔ on-chain parity matrix

| Schema element | Off-chain (`policy/`, advisory, fail-closed UX) | On-chain (`PolicyModule`/`SessionKeyValidator`/vault, authoritative) |
|---|---|---|
| Allowlist `(target,selector)` | decode calldata, match `packages/shared` allowlist | `isAllowedTarget(target,selector)`; adapters are the only protocol-naming code |
| Asset set | assert token ∈ entry.assets | adapter encodes only allowlisted assets |
| Recipient pin | decode + assert == user_account | validator/adapter forces recipient field to account |
| Per-user / total / vault caps | read chain fresh, project post-state | `Vault.maxDeposit` + `deposit` (ERC-4626) |
| Per-tx / cumulative caps | preview against `spent` | `PolicyModule` in `validateUserOp` (`spent` monotonic) |
| Slippage | sim slippage ≤ userMax; min-out ≥ floor | `amountOutMin ≥ floor` + AMM reverts on min-out |
| Hard expiry | reject if past `validUntil` | packed `validUntil` → EntryPoint rejects |
| Kill-switch (exit-exempt) | skip pause for exits; else reject if paused | vault `whenDepositsAllowed` on deposit only; withdraw unmodified |
| Mandate conformance | enforced | (allowlist already constrains; not on-chain at launch) |
| `policyVersion` | stamped on every verdict | identified by deployed module + CapRegistry params |

**Drift prevention:** allowlist addresses, caps, slippage floors, and selectors live once in `packages/shared` (policy constants), consumed by the off-chain layer and the on-chain deploy script (`ArmGuardrails`). A CI job asserts the on-chain reads equal the shared constants; a mismatch fails the pipeline.

---

## 10. Traceability

| Schema section | FR / SC | Invariant | Guardrail |
|---|---|---|---|
| §3 Allowlist `(target,selector)` | FR-016, FR-027, SC-006 | — | **G5** |
| §4 Caps (exit-exempt) | FR-025, SC-009 | caps, **N2** | **G2** |
| §4.1 Performance-fee governance param (capped 20%, timelocked, profit-only, non-custody, exit-never-gated) | FR-017, FR-037 | **N1, N2, N5, N-fee** | G6 |
| §5 Slippage / sim | FR-021, FR-023, SC-002 | — | **G4** |
| §6 Session-key scope grammar | FR-029/030/036, SC-008 | **N4** | G2, G5 |
| §6 rule 7 Revocation exit-exempt | FR-031, FR-032 | **N4** | — |
| §8 ordered fail-closed `evaluate` | FR-008, FR-023, FR-027 | — | **G1** |
| §8 explicit exit branch | FR-026, FR-034, SC-003 | **N2** | G3 |
| §3b/§6.5 recipient pin | FR-033, SC-004 | **N1** | — |
| §1 `policyVersion` logging | FR-038, SC-012 | **N5** | — |

**Net:** one versioned, deterministic schema — allowlist `(target,selector)`, exit-exempt caps, swap-only slippage floors, and a narrowing-only session-key grammar — is evaluated in a fixed fail-closed order by a pure off-chain layer (so the user is never shown an out-of-policy action) and re-enforced by immutable on-chain code (so it holds even if the off-chain layer is bypassed), with withdrawals structurally exempt from every gate.
