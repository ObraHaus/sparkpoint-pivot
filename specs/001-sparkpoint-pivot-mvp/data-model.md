# Data Model: SparkPoint Pivot — AI-Native Onchain Hedge Fund (Launch MVP)

**Branch**: `001-sparkpoint-pivot-mvp` | **Date**: 2026-06-15 | **Plan**: ./plan.md | **Spec**: ./spec.md

**Phase**: 1 (Design) | **Storage**: PostgreSQL + `pgvector` (offchain); Base (chainId 8453) is the onchain source of truth.

---

## 0. Purpose, Scope, and Reading Order

This document defines the persisted and onchain-derived data model for the launch MVP. It is the canonical mapping from the spec's **Key Entities** to concrete Postgres tables, pgvector embedding stores, and onchain-derived projections, plus the lifecycle/state machines and validation rules that the deterministic policy layer and the data/indexing pipeline enforce.

It exists to make two things true at once:

1. **Provable, not promised.** Every user-facing figure (PnL, APY, allocation, vault value, outcome) is **onchain-reconstructable** from `onchain_events` + a block-anchored price snapshot. Postgres is a *derived index and accelerator*, never the source of truth for custody-critical values and never on the withdrawal path.
2. **AI proposes, deterministic policy + user disposes.** The data model carries `policyVersion`, frozen `context_snapshots`, and a recommendation→tx→realized-PnL attribution chain so that what the AI proposed, what the policy layer approved, what the user signed, and what actually happened are all independently auditable.

**Authority ordering for any value used in a pre-sign gate or custody-critical display: RPC > subgraph > Dune > HTTP price API.** No cached/derived value in Postgres is ever the gate for a signature; the policy layer re-reads fresh from RPC at decision time (see §16).

**Layering of state** (every entity is tagged with exactly one):

| Tag | Meaning | Authority |
|-----|---------|-----------|
| **OFFCHAIN** | Lives only in Postgres/pgvector; product/UX/learning data with no onchain analogue (e.g., chat, mandate, recommendation rationale). | Postgres |
| **ONCHAIN** | The authoritative state lives in a Base contract or on Base; Postgres holds at most a derived mirror. | Base contract |
| **ONCHAIN-DERIVED** | Computed by the indexer purely from onchain events + a logged price snapshot; **reconstructable** by anyone replaying chain history. | Base events + frozen price snapshot |

---

## 1. Entity Catalog (spec Key Entities → model artifacts)

| # | Spec Key Entity | Modeled as | State layer | Primary store |
|---|-----------------|-----------|-------------|---------------|
| E1 | User | `users` | OFFCHAIN (links to ONCHAIN account) | Postgres |
| E2 | Wallet / SmartAccount | `smart_accounts` (mirror of `SparkPointAccount`) | ONCHAIN | Base + Postgres mirror |
| E3 | Risk Profile / Mandate | `mandates` (versioned) | OFFCHAIN | Postgres |
| E4 | Goal | `goals` (children of a mandate) | OFFCHAIN | Postgres |
| E5 | Portfolio | `portfolio_snapshots` (materialized view object) | ONCHAIN-DERIVED | Postgres (derived) |
| E6 | Position | `indexed_positions` | ONCHAIN-DERIVED | Postgres (derived) |
| E7 | Strategy Recommendation | `recommendations` | OFFCHAIN | Postgres |
| E8 | Vault | `vaults` (mirror of `SparkPointVault`) | ONCHAIN | Base + Postgres mirror |
| E9 | Vault Position (ERC-4626 shares) | `indexed_positions` (kind=`vault_shares`) + `vault_share_events` | ONCHAIN-DERIVED | Postgres (derived) |
| E8a | Fee Accrual / Fee Event (performance fee) | `fee_events` | ONCHAIN-DERIVED | Postgres (derived) |
| E10 | Session Key + Policy Scope | `session_keys` (mirror of `SessionKeyValidator`/`PolicyModule`) | ONCHAIN | Base + Postgres mirror |
| E11 | Execution / Transaction | `executions` + `intent_bundles` | OFFCHAIN intent + ONCHAIN-DERIVED result | Postgres |
| E12 | Simulation Result | `simulation_results` | OFFCHAIN (Tenderly snapshot) | Postgres |
| E13 | Outcome Log Entry | `outcome_logs` | ONCHAIN-DERIVED PnL over OFFCHAIN link | Postgres |
| E14 | Literacy Tip | `literacy_tips` + `literacy_tip_impressions` | OFFCHAIN | Postgres |
| E15 | Beta Whitelist Entry | `beta_whitelist` | OFFCHAIN | Postgres |
| E16 | Audit Log | `audit_logs` | OFFCHAIN | Postgres |
| — | (supporting) Chat | `chat_messages` | OFFCHAIN | Postgres |
| — | (supporting) Memory/RAG | `memory_chunks` | OFFCHAIN (pgvector) | Postgres |
| — | (supporting) Frozen context | `context_snapshots` | OFFCHAIN snapshot of ONCHAIN-DERIVED | Postgres |
| — | (supporting) Risk events | `risk_events` | ONCHAIN-DERIVED / OFFCHAIN labels | Postgres |
| — | (supporting) Onchain event log | `onchain_events` | ONCHAIN-DERIVED (raw indexed) | Postgres |
| — | (supporting) Price snapshots | `price_snapshots` | ONCHAIN-DERIVED canon | Postgres |
| — | (supporting) Trust Center read | `permission_manifests` | ONCHAIN (read straight from chain) | Postgres cache of chain reads |
| — | (supporting) Data source health | `data_source_health` | OFFCHAIN | Postgres |
| — | (supporting) Indexer cursors | `indexer_cursors` | OFFCHAIN | Postgres |
| — | (supporting) SRK view | `srk_view` (read model only) | ONCHAIN-DERIVED display | Postgres (non-gating) |

**Convention notes.** Primary keys are UUID v7 (`id`) unless mirroring an onchain primary identity (then the onchain identifier is the natural key). Monetary amounts are stored as `NUMERIC(78,0)` in base units (wei / token smallest unit) to match EVM exactly, with a separate `*_decimals` where the token matters; human display values are derived, never stored as the source. All timestamps are `TIMESTAMPTZ` (UTC). Addresses are stored `CITEXT` lower-cased + checksummed-on-read. Every table carries `created_at` and, where mutable, `updated_at`. **No keys, secrets, signed payloads, or private keys are ever stored** (Constitution / plan §Storage).

---

## 2. Entity-Relationship Overview

```text
beta_whitelist ──(gates)──▶ users ──1:1──▶ smart_accounts ─(onchain owner = user EOA)
       │                       │                  │
       │                       │                  ├──1:N──▶ session_keys ──▶ policy_scope (embedded)
       │                       │                  │
       │              1:N (versioned)             ├──1:N──▶ indexed_positions ◀── derived from onchain_events
       │                       ▼                  │            (kind: aave_supply | token_balance | vault_shares)
       │                  mandates ──1:N──▶ goals  │
       │                       │                  └──(aggregate)──▶ portfolio_snapshots
       │                       │
users ─┴──1:N──▶ chat_messages │
       │                       ▼
       │              recommendations ──1:N──▶ intent_bundles ──1:1──▶ simulation_results
       │                  │  │                      │
       │                  │  │                      ▼
       │                  │  └─────────────▶ executions ──(onchain tx)──▶ onchain_events
       │                  │                      │
       │                  └──1:1──▶ outcome_logs ◀┘   (links recommendation → realized PnL)
       │                              │
       │                       context_snapshots (frozen at proposal time)
       │
vaults ──(global, single)──▶ vault_share_events ──▶ indexed_positions(kind=vault_shares)
       └──(performance fee accrual)──▶ fee_events ──▶ fee shares minted to feeRecipient
price_snapshots ──(block-anchored canon)──▶ used by every ONCHAIN-DERIVED computation
memory_chunks (pgvector) ◀── embeddings of chat, mandate, recommendation, outcome
audit_logs ◀── append-only record of every policy verdict, cap check, kill-switch read, signature event
permission_manifests ◀── exact onchain permissions for Trust Center "prove-it"
```

---

## 3. E1 — User  *(OFFCHAIN)*

A whitelisted beta participant who **solely owns and signs for** their smart account. The user record is product/identity metadata only; custody identity is the onchain smart account (E2), which is bound to the user's self-custodied EOA.

**Table `users`**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | Internal user id. |
| `eoa_address` | CITEXT UNIQUE NOT NULL | The user's self-custodied signer EOA (WalletConnect/Coinbase). **Sole owner/admin** of the smart account (N3). |
| `smart_account_address` | CITEXT NULL UNIQUE | FK→`smart_accounts.address`; null until first account deploy (counterfactual address may be known earlier — stored in `smart_accounts`). |
| `display_handle` | TEXT NULL | Optional non-PII handle. |
| `onboarding_state` | ENUM `onboarding_state` NOT NULL | See §3.1 lifecycle. |
| `active_mandate_id` | UUID NULL | FK→`mandates.id` (the currently effective version). |
| `geo_region` | TEXT NULL | Coarse region from edge geo-fence at signup; informational. **Not** a custody gate. |
| `srk_balance_cached` | NUMERIC(78,0) NULL | Display-only mirror (E-SRK). Never gates any core function (FR-045/046). |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | Soft disable for app access only; never blocks onchain withdraw (N2). |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Relationships.** 1:1 `smart_accounts`; 1:N `mandates`, `chat_messages`, `recommendations`, `outcome_logs`, `session_keys`; gated by exactly one `beta_whitelist` row.

### 3.1 Lifecycle — `onboarding_state`

```text
prospective ──(wallet connected & whitelist match)──▶ wallet_connected
wallet_connected ──(smart account deployed/counterfactual armed)──▶ account_ready
account_ready ──(chat onboarding completes, mandate confirmed)──▶ mandated
mandated ──(any later flow)──▶ active
active ──(user edits goals/risk)──▶ active (active_mandate_id repoints to new version)
[any] ──(admin disable / off-whitelist)──▶ suspended   # app access only; onchain exit unaffected
```

**Validation rules.**
- VR-U1: `eoa_address` MUST match an `enabled` `beta_whitelist` row to leave `prospective` and to perform any state-changing app action (FR-042). Withdraw via `/exit` is **never** gated on this (N2).
- VR-U2: a user MUST NOT advance past `wallet_connected` if `geo_region ∈ restricted_set` at the edge (FR-044) — but `suspended`/geo-blocked users retain the onchain escape hatch.
- VR-U3: `smart_account_address`, when set, MUST resolve onchain to an account whose `owner == eoa_address` (N3); the indexer asserts this and raises a `risk_event` on mismatch.
- VR-U4: SRK fields are advisory; no constraint, trigger, or query path may make a core capability conditional on `srk_balance_cached` (SC-013).

---

## 4. E2 — Wallet / SmartAccount  *(ONCHAIN, Postgres mirror)*

The ERC-4337 `SparkPointAccount` is the **custody identity**. Postgres holds a **read-only mirror** derived from factory/account events; the chain is authoritative. The account's `owner` is the user's EOA — there is no SparkPoint co-signer, recovery backdoor, or server-side keystore (N3).

**Table `smart_accounts`** *(mirror)*

| Field | Type | Layer | Onchain-reconstructable? | Notes |
|-------|------|-------|--------------------------|-------|
| `address` | CITEXT PK | ONCHAIN | yes (CREATE2 deterministic) | Counterfactual address derivable before deploy. |
| `owner_eoa` | CITEXT NOT NULL | ONCHAIN | **yes** | `owner()` read; MUST equal `users.eoa_address`. |
| `factory_address` | CITEXT NOT NULL | ONCHAIN | yes | `AccountFactory`. |
| `salt` | NUMERIC(78,0) NOT NULL | ONCHAIN | yes | CREATE2 salt for counterfactual derivation. |
| `entrypoint_address` | CITEXT NOT NULL | ONCHAIN | yes | EntryPoint v0.7 (v0.6 fallback per research). |
| `deploy_tx_hash` | BYTEA NULL | ONCHAIN-DERIVED | yes | Null while counterfactual-only. |
| `deploy_block` | BIGINT NULL | ONCHAIN-DERIVED | yes | |
| `is_deployed` | BOOLEAN NOT NULL | ONCHAIN-DERIVED | yes | Code-at-address check. |
| `implementation_address` | CITEXT NULL | ONCHAIN | yes | UUPS impl; **owner-only upgrade, never SparkPoint** (N3/N5). |
| `installed_validators` | JSONB NOT NULL | ONCHAIN | yes | Owner ECDSA + `SessionKeyValidator`. |
| `last_synced_block` | BIGINT | OFFCHAIN | n/a | Indexer cursor for this account. |

**Validation rules.**
- VR-SA1 (N1/N3): the mirror MUST never record any non-owner address with an asset-movement capability; the indexer cross-checks installed modules against the audited allowlist and raises a `risk_event` otherwise.
- VR-SA2 (N5): if `implementation_address` changes to anything not in the audited impl set, raise a critical `risk_event`; upgrades are owner-only by construction (the model only records, never authorizes).
- VR-SA3: counterfactual accounts MAY exist (`is_deployed=false`) and MUST be shown to the user with their derivable address before first deploy.

---

## 5. E3 — Risk Profile / Mandate  *(OFFCHAIN, versioned)* and E4 — Goal  *(OFFCHAIN)*

The personalized expression of a user's goals + risk tolerance, produced during chat onboarding, **confirmed by the user**, used to rank recommendations and constrain suggested actions. **Versioned, immutable per version** — editing produces a new version and repoints `users.active_mandate_id`, preserving the exact ruleset that scored any historical recommendation (provability).

**Table `mandates`**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | Mandate version id. |
| `user_id` | UUID NOT NULL FK→users | |
| `version` | INT NOT NULL | Monotonic per user; `(user_id, version)` UNIQUE. |
| `status` | ENUM `mandate_status` NOT NULL | `draft` → `confirmed` → `superseded`/`archived`. |
| `risk_tier` | ENUM `risk_tier` NOT NULL | `conservative` \| `moderate` \| `growth` (launch defaults conservative; vault is conservative-only). |
| `risk_score` | SMALLINT NOT NULL | 0–100 normalized, derived from onboarding answers. |
| `max_slippage_bps` | INT NOT NULL | User max slippage; consumed by policy/sim gates (FR-021/023). |
| `time_horizon` | ENUM | `short` \| `medium` \| `long`. |
| `allowed_assets` | TEXT[] NOT NULL | Subset of {USDC, ETH}; informs recommendations (never widens the onchain allowlist). |
| `liquidity_pref` | ENUM | `instant` \| `flexible` — withdraw-always always honored regardless. |
| `summary_text` | TEXT NOT NULL | Human-readable mandate shown back for confirmation (FR-002). |
| `derived_from_chat_range` | INT8RANGE NULL | `chat_messages.seq` span that produced it (provenance). |
| `confirmed_at` | TIMESTAMPTZ NULL | Set when user confirms; required to be effective. |
| `embedding_id` | UUID NULL | FK→`memory_chunks` (pgvector) for RAG retrieval. |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Table `goals`** (children of a mandate version)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | |
| `mandate_id` | UUID NOT NULL FK→mandates | |
| `kind` | ENUM `goal_kind` | `preserve_capital` \| `earn_yield` \| `grow` \| `target_amount` \| `target_date`. |
| `target_asset` | TEXT NULL | e.g., USDC. |
| `target_amount` | NUMERIC(78,0) NULL | Base units (for `target_amount`/`target_date`). |
| `target_date` | DATE NULL | |
| `priority` | SMALLINT NOT NULL | Ranking weight used by the recommender. |
| `narrative` | TEXT NULL | User's own words (also embedded). |

### 5.1 Lifecycle — `mandate_status`

```text
draft ──(user confirms summary)──▶ confirmed ──(set users.active_mandate_id)
confirmed ──(user edits goals/risk → new version created)──▶ superseded
confirmed ──(account closed)──▶ archived
```

**Validation rules.**
- VR-M1: exactly **one** `confirmed` mandate per user MAY be `active_mandate_id` at a time; superseding is atomic with repointing.
- VR-M2: a mandate is effective for ranking/constraint **only** when `status='confirmed'` and `confirmed_at IS NOT NULL` (FR-002/003).
- VR-M3: `max_slippage_bps` MUST be within the protocol hard ceiling; the policy layer takes `min(mandate, hard_ceiling)` and never the looser of the two.
- VR-M4: a mandate version is **immutable** once `confirmed`; edits fork a new `version` (preserves the exact ruleset attached to historical recommendations for provability).
- VR-M5: `risk_tier`/`allowed_assets` MAY only narrow what is onchain-allowlisted; they can never authorize a non-whitelisted protocol/asset (FR-016).

---

## 6. E5 — Portfolio  *(ONCHAIN-DERIVED)* and E6 — Position  *(ONCHAIN-DERIVED)*

The aggregate, reconstructable view of a user's holdings across Base assets, including vault and Aave positions, with per-position + total PnL and allocation. **No portfolio value is stored as source** — it is computed from `onchain_events` + `price_snapshots` and is fully reconstructable.

**Table `indexed_positions`** *(derived)*

| Field | Type | Onchain-reconstructable? | Notes |
|-------|------|--------------------------|-------|
| `id` | UUID v7 PK | n/a | |
| `smart_account_address` | CITEXT NOT NULL | yes | Owner of the position. |
| `kind` | ENUM `position_kind` NOT NULL | yes | `token_balance` \| `aave_supply` \| `vault_shares`. |
| `protocol` | ENUM | yes | `none` \| `aave_v3` \| `sparkpoint_vault` \| `aerodrome`. |
| `asset_address` | CITEXT NOT NULL | yes | Underlying token (USDC/ETH/aToken/share token). |
| `asset_decimals` | SMALLINT NOT NULL | yes | |
| `balance_raw` | NUMERIC(78,0) NOT NULL | **yes** (RPC `balanceOf` / `convertToAssets`) | Current onchain balance/aToken/shares. |
| `cost_basis_raw` | NUMERIC(78,0) NOT NULL | **yes** (replay of deposits/swaps, average-cost) | MVP cost-basis method = **average-cost** (per research). |
| `accrued_yield_raw` | NUMERIC(78,0) NULL | **yes** (aToken/share growth vs principal) | Aave/vault yield. |
| `realized_pnl_raw` | NUMERIC(78,0) NOT NULL DEFAULT 0 | **yes** | From closed/withdrawn portions. |
| `unrealized_pnl_raw` | NUMERIC(78,0) | **yes** (mark with `price_snapshot_id`) | Recomputed on read; snapshot pinned for audit. |
| `price_snapshot_id` | UUID NULL FK→price_snapshots | yes | Block-anchored mark used. |
| `as_of_block` | BIGINT NOT NULL | yes | Reorg-safe confirmed block. |
| `is_stale` | BOOLEAN NOT NULL DEFAULT false | n/a | Set when source health degrades (see §16). |
| `updated_at` | TIMESTAMPTZ | n/a | |

**Portfolio object `portfolio_snapshots`** (aggregation, recomputable):

| Field | Type | Notes |
|-------|------|-------|
| `smart_account_address` | CITEXT | Grouping key. |
| `as_of_block` | BIGINT | |
| `total_value_quote_raw` | NUMERIC(78,0) | In USDC-quote; derived from positions + price snapshot. |
| `total_pnl_raw` | NUMERIC(78,0) | Sum realized + unrealized. |
| `allocation` | JSONB | `[{asset, pct_bps, value}]` — derived, recomputable. |
| `price_snapshot_id` | UUID FK | The mark used for the whole snapshot (single consistent block-anchored price). |

**Validation rules.**
- VR-P1 (SC-011): displayed positions/PnL/allocation MUST reconcile with fresh RPC balances at `as_of_block`; a reconciliation job flags drift and marks `is_stale`.
- VR-P2: empty portfolio MUST render an empty state, not an error (FR-013) — model returns zero rows cleanly.
- VR-P3: any number shown MUST cite a `price_snapshot_id`; values without a pinned snapshot are display-prohibited (provability).
- VR-P4: portfolio reads are **never** a gate for a signature; gates re-read RPC live.

---

## 7. E7 — Strategy Recommendation  *(OFFCHAIN)*

A ranked suggestion scored against the user's mandate, carrying a plain-language rationale and `citations[]` grounded in tool results, referencing **only** whitelisted protocols/in-policy actions. The recommender is the visible "fund manager" intelligence; it is OFFCHAIN, but its proposed actions become signable only after the deterministic policy layer approves them (E11/E12).

**Table `recommendations`**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | The `recommendationId` carried through to outcomes/IntentLog. |
| `user_id` | UUID NOT NULL FK | |
| `mandate_id` | UUID NOT NULL FK | The exact mandate **version** it was scored against (provability). |
| `chat_message_id` | UUID NULL FK | Message that surfaced it. |
| `rank` | SMALLINT NOT NULL | 1 = top; ranking relative to goal (FR-014). |
| `title` | TEXT NOT NULL | e.g., "Move idle USDC into the Aave Yield Vault". |
| `rationale` | TEXT NOT NULL | Plain-language "why" (FR-006/015). |
| `citations` | JSONB NOT NULL | Tool-result provenance (Dune/subgraph/DeFiLlama/RPC), not model memory. |
| `proposed_protocol` | ENUM NOT NULL | MUST ∈ {`aave_v3`, `aerodrome`, `sparkpoint_vault`} (FR-016). |
| `proposed_action` | ENUM `action_kind` NOT NULL | `vault_deposit` \| `vault_withdraw` \| `aave_supply` \| `aave_withdraw` \| `aero_swap` \| `rebalance`. |
| `proposed_params` | JSONB NOT NULL | Asset(s), amount, direction — inputs to the build/sim step. |
| `expected_apy_bps` | INT NULL | Display estimate; flagged as estimate. |
| `score` | NUMERIC NOT NULL | Mandate-conformance score driving `rank`. |
| `status` | ENUM `recommendation_status` NOT NULL | See §7.1. |
| `context_snapshot_id` | UUID NULL FK→context_snapshots | Frozen world at proposal time. |
| `embedding_id` | UUID NULL FK→memory_chunks | For RAG over past recommendations/outcomes. |
| `created_at` | TIMESTAMPTZ | |

### 7.1 Lifecycle — `recommendation_status`

```text
proposed ──(user dismisses)──▶ dismissed
proposed ──(user picks → Executor builds IntentBundle)──▶ acted_pending
acted_pending ──(policy REJECT)──▶ blocked            # never becomes signable (FR-008)
acted_pending ──(user declines / wallet rejects)──▶ abandoned
acted_pending ──(user signs & tx mined)──▶ executed ──(create outcome_log)
proposed ──(expires)──▶ expired
```

**Validation rules.**
- VR-R1 (FR-016 / SC-006): `proposed_protocol` MUST be whitelisted and `proposed_params` MUST pass the offchain policy mirror **before** the recommendation can leave `proposed`; out-of-policy proposals are never surfaced as signable.
- VR-R2: a recommendation MUST cite its `mandate_id` version; recommendations without a confirmed mandate are blocked (depends on E3 effectiveness).
- VR-R3: every recommendation MUST carry non-empty `rationale` (SC-005) and `citations`.
- VR-R4: only an `executed` recommendation creates an `outcome_log` (E13); `blocked`/`abandoned` do not.

---

## 8. E8 — Vault  *(ONCHAIN, single, non-upgradeable, 0-management / profit-only performance-fee)*

The single conservative `SparkPointVault` (ERC-4626) accepting USDC, routing to Aave v3 yield, issuing/redeeming shares, withdrawable anytime, governed for **pause only** (plus a single timelocked, hard-capped fee-rate parameter). Postgres mirrors immutable config + cap state from chain; the chain is authoritative.

**Fee model (ACTIVE at launch).** The vault is **0-management / profit-only performance-fee**, not "0-fee": **0% management, 0% entry/exit, 0% on principal**, and a **performance fee of 10% on realized YIELD ONLY** (configurable on-chain within a **hard cap of 20%**; default 10%). The fee is charged **only on realized yield above a high-water mark (HWM)** on share price — **never on principal, never in flat or down periods** (no fee at/below the HWM). It is realized by **minting fee shares to a `feeRecipient`** during lazy fee accrual (on deposit/withdraw/harvest): mint shares whose claim equals `feeRate × (assets gained above HWM since last accrual)`, then advance the HWM (see §8a). `feeRecipient` is an **ordinary, non-privileged share holder** — it redeems via the same withdraw/redeem path as any user, has **no** admin/withdraw authority over other users' shares, and **cannot block, delay, or reorder** any user's redemption. Trust message intact: **we only earn when you earn — never on your principal, never by taking custody.** `feeRate` is the **only** mutable parameter (timelocked, hard-capped at 20%, multisig-bounded) and can **never** alter custody/withdraw/principal semantics; the vault remains **non-upgradeable** in custody semantics. Fully disclosed pre-deposit and in receipts; net-of-everything APY shown; **provable on-chain**.

**Table `vaults`** *(mirror; effectively one row at launch)*

| Field | Type | Layer | Onchain-reconstructable? | Notes |
|-------|------|-------|--------------------------|-------|
| `address` | CITEXT PK | ONCHAIN | yes | `SparkPointVault`. |
| `asset_address` | CITEXT NOT NULL | ONCHAIN (immutable) | yes | USDC. |
| `share_symbol` | TEXT NOT NULL | ONCHAIN | yes | ERC-4626 share token symbol. |
| `aave_pool_address` | CITEXT NOT NULL | ONCHAIN (immutable) | yes | Aave v3 Pool. |
| `atoken_address` | CITEXT NOT NULL | ONCHAIN (immutable) | yes | aUSDC held by vault. |
| `management_fee_bps` | INT NOT NULL CHECK(=0) | ONCHAIN (constant) | yes | **0% management, a constant, not settable** (N5). |
| `entry_fee_bps` | INT NOT NULL CHECK(=0) | ONCHAIN (constant) | yes | **0% entry/principal, pure-constant** (N1). |
| `exit_fee_bps` | INT NOT NULL CHECK(=0) | ONCHAIN (constant) | yes | **0% exit/principal, pure-constant** (N2). |
| `performance_fee_bps` | INT NOT NULL CHECK(BETWEEN 0 AND 2000) | ONCHAIN (mutable: timelocked, hard-capped) | yes | Performance fee on realized yield only; default 1000 (10%); **hard cap 2000 (20%)**; the **only** mutable param (timelocked, multisig-bounded). Never alters custody/withdraw/principal (N1/N2/N5). |
| `fee_recipient` | CITEXT NOT NULL | ONCHAIN | yes | Receives minted fee shares; an **ordinary, non-privileged** share holder — redeems via the normal path, no admin/withdraw authority, cannot block/delay/reorder any redemption (N1/N2). |
| `high_water_mark_ray` | NUMERIC(78,0) NOT NULL | ONCHAIN-DERIVED | **yes** (HWM advance events) | High-water mark on share price; fee accrues only on realized yield **above** this, never below/at it. |
| `is_upgradeable` | BOOLEAN NOT NULL CHECK(=false) | ONCHAIN | yes | No proxy/admin slot in custody semantics (N5). |
| `total_assets_raw` | NUMERIC(78,0) | ONCHAIN-DERIVED | **yes** (`totalAssets()`/aToken bal) | Mirror; recomputable. |
| `total_supply_raw` | NUMERIC(78,0) | ONCHAIN-DERIVED | **yes** (`totalSupply()`) | Shares outstanding. |
| `share_price_ray` | NUMERIC(78,0) | ONCHAIN-DERIVED | **yes** (`convertToAssets(1e18)`) | Display-only mark. |
| `deposits_paused` | BOOLEAN NOT NULL | ONCHAIN | yes (`paused()`) | Pause-only; **does not** affect withdraw (N2). |
| `deposit_cap_raw` | NUMERIC(78,0) NOT NULL | ONCHAIN | yes | From `CapRegistry`, within hard ceiling. |
| `per_user_cap_raw` | NUMERIC(78,0) NOT NULL | ONCHAIN | yes | Per-user TVL cap (FR-025). |
| `total_protocol_cap_raw` | NUMERIC(78,0) NOT NULL | ONCHAIN | yes | Global cap. |

**Validation rules.**
- VR-V1 (N5/FR-037): `management_fee_bps`, `entry_fee_bps`, `exit_fee_bps` MUST be 0 (pure-constant, 0% on principal/management) and `is_upgradeable` MUST be false; the post-deploy assertion script and indexer both verify EIP-1967 slots are empty and no `Upgraded`/`AdminChanged` events exist.
- VR-V1a (N1/N5): `performance_fee_bps` MUST be within `[0, 2000]` (hard cap 20%; default 1000) and is the **only** mutable parameter; rate changes MUST be timelocked + multisig-bounded, and the indexer raises a critical `risk_event` if any rate change bypasses the timelock or exceeds the hard cap. A rate change can **never** alter custody/withdraw/principal semantics.
- VR-V1b (N1): the performance fee is charged **only on realized yield above `high_water_mark_ray`**; a user's redeemable **principal** is never reduced below deposited principal by fee shares. No fee accrues when share price is at/below the HWM.
- VR-V2 (N2/FR-026/034): `deposits_paused=true` MUST never block a `withdraw`/`redeem`; the model only mirrors pause for **deposit** gating + display.
- VR-V3 (FR-025/SC-009): a deposit that would breach `per_user_cap`, `deposit_cap`, or `total_protocol_cap` MUST be blocked **before signing**; caps are read fresh from chain at gate time, not from this mirror.

---

## 8a. E8a — Fee Accrual / Fee Event (performance fee)  *(ONCHAIN-DERIVED)*

A granular ledger of each **lazy performance-fee accrual** (triggered on deposit/withdraw/harvest). Each event records the yield realized above the high-water mark, the fee shares minted to `feeRecipient`, and the HWM before/after the advance. Like `vault_share_events`, these are **fully reconstructable on-chain** by replaying ERC-4626 events + the fee-accrual/HWM-advance events — the fee is **provable on-chain**, computed off **realized yield above the HWM**, and **never reduces principal**.

**Table `fee_events`** *(derived from fee-accrual / HWM-advance events)*

| Field | Type | Onchain-reconstructable? | Notes |
|-------|------|--------------------------|-------|
| `id` | UUID v7 PK | n/a | |
| `vault_address` | CITEXT NOT NULL | yes | FK→`vaults.address`. |
| `fee_recipient` | CITEXT NOT NULL | yes | The non-privileged holder the fee shares were minted to (mirrors `vaults.fee_recipient`). |
| `block_time` | TIMESTAMPTZ NOT NULL | yes | Accrual block timestamp. |
| `block_number` | BIGINT NOT NULL | yes | |
| `trigger_kind` | ENUM `fee_trigger` NOT NULL | yes | `deposit` \| `withdraw` \| `harvest` — the lazy-accrual trigger. |
| `fee_rate_bps_at_event` | INT NOT NULL | yes | `performance_fee_bps` in effect at accrual (≤ 2000). |
| `yield_realized_raw` | NUMERIC(78,0) NOT NULL | **yes** (assets gained above HWM since last accrual) | Fee base: realized yield **above the HWM only**; never principal. 0 ⇒ no fee minted. |
| `fee_shares_minted_raw` | NUMERIC(78,0) NOT NULL DEFAULT 0 | **yes** (share mint to `feeRecipient`) | Shares whose claim equals `feeRate × yield_realized_raw`; 0 in flat/down periods. |
| `hwm_before_ray` | NUMERIC(78,0) NOT NULL | **yes** | Share-price HWM before this accrual. |
| `hwm_after_ray` | NUMERIC(78,0) NOT NULL | **yes** | HWM after the advance; `≥ hwm_before_ray` (monotonic non-decreasing). |
| `tx_hash` | BYTEA NOT NULL | yes | |
| `log_index` | INT NOT NULL | yes | `(tx_hash, log_index)` UNIQUE (idempotent indexing). |

**Validation rules.**
- VR-FE1 (N1): `yield_realized_raw` MUST be the assets gained **above `hwm_before_ray` only**; a fee accrual MUST NEVER draw on principal. When share price is at/below the HWM, `yield_realized_raw = 0` and `fee_shares_minted_raw = 0` (no fee in flat or down periods).
- VR-FE2: `fee_shares_minted_raw` MUST reconcile to `fee_rate_bps_at_event × yield_realized_raw` at the event's share price, and `fee_rate_bps_at_event ≤ 2000` (hard cap); drift raises a `risk_event`.
- VR-FE3 (N2, withdraw-always / fail-open): fee accrual MUST **fail-open** — if a fee cannot be computed or minted, the accrual is **skipped** and the deposit/withdraw/redeem still proceeds; a redemption path MUST NEVER depend on a fee being collectible, and no `fee_events` row may block, delay, or revert a redemption.
- VR-FE4: `hwm_after_ray ≥ hwm_before_ray` (the HWM only advances, never retreats); indexing is idempotent on `(tx_hash, log_index)` and reorg-safe.
- VR-FE5: the full fee history MUST be reconstructable from `fee_events` (+ underlying ERC-4626 events) alone, so the performance fee is **provable on-chain** independent of the indexer.

---

## 9. E9 — Vault Position (ERC-4626 shares)  *(ONCHAIN-DERIVED)*

A user's stake in the vault, denominated in shares representing a proportional claim on USDC + accrued yield, redeemable anytime. Modeled as `indexed_positions(kind='vault_shares')` (§6) plus a granular event ledger for exact share accounting and reconstruction.

**Table `vault_share_events`** *(derived from ERC-4626 events)*

| Field | Type | Onchain-reconstructable? | Notes |
|-------|------|--------------------------|-------|
| `id` | UUID v7 PK | n/a | |
| `vault_address` | CITEXT NOT NULL | yes | |
| `smart_account_address` | CITEXT NOT NULL | yes | |
| `event_kind` | ENUM | yes | `deposit` \| `withdraw` \| `redeem` \| `transfer_in` \| `transfer_out`. |
| `assets_raw` | NUMERIC(78,0) | **yes** (ERC-4626 `Deposit`/`Withdraw` event) | USDC in/out. |
| `shares_raw` | NUMERIC(78,0) | **yes** | Shares minted/burned. |
| `share_price_ray_at_event` | NUMERIC(78,0) | **yes** (`convertToAssets` at block) | For PnL attribution. |
| `tx_hash` | BYTEA NOT NULL | yes | |
| `log_index` | INT NOT NULL | yes | `(tx_hash, log_index)` UNIQUE (idempotent indexing). |
| `block_number` | BIGINT NOT NULL | yes | |
| `block_time` | TIMESTAMPTZ NOT NULL | yes | |

**Validation rules.**
- VR-VP1 (FR-018): shares minted MUST be proportional to assets deposited and redeem MUST return principal + realized yield with **0% on principal and 0% management/entry/exit** — verified by reconciling `assets_raw`/`shares_raw` against `share_price_ray_at_event`. The only fee is the **performance fee on realized yield above the HWM** (§8a), taken as fee shares minted to `feeRecipient`, never as a deduction from a redeeming user's principal.
- VR-VP2 (N2/SC-003): the model MUST be able to reconstruct a user's full redeemable balance from `vault_share_events` alone, so withdraw-always remains provable even with the indexer offline (the indexer is an accelerator, not a dependency).
- VR-VP3: indexing is idempotent on `(tx_hash, log_index)`; reorgs below the confirmation lag roll back affected rows.

---

## 10. E10 — Session Key + Policy Scope  *(ONCHAIN, Postgres mirror)*

A time-boxed, scope-bounded authorization for opt-in automation, defined by the onchain `PolicyModule` (allowlisted vaults/targets, per-tx + cumulative caps, max slippage, hard expiry), **instantly and unilaterally revocable by the user**. The chain is authoritative and the final backstop even if the agent is compromised; Postgres mirrors for display and the offchain policy mirror.

**Table `session_keys`** *(mirror of `SessionKeyValidator`/`PolicyModule` storage)*

| Field | Type | Layer | Onchain-reconstructable? | Notes |
|-------|------|-------|--------------------------|-------|
| `id` | UUID v7 PK | n/a | | |
| `smart_account_address` | CITEXT NOT NULL | ONCHAIN | yes | Owning account. |
| `session_pubkey` | CITEXT NOT NULL | ONCHAIN | yes | The session signer (agent-side public key; **no private key stored anywhere by SparkPoint**). |
| `status` | ENUM `session_key_status` NOT NULL | ONCHAIN-DERIVED | yes | See §10.1. |
| **Policy scope (embedded, all ONCHAIN):** | | | | |
| `allowlisted_targets` | CITEXT[] NOT NULL | ONCHAIN | yes | Allowlisted vaults/adapters only (N4). |
| `allowlisted_selectors` | BYTEA[] NOT NULL | ONCHAIN | yes | Permitted function selectors. |
| `per_tx_cap_raw` | NUMERIC(78,0) NOT NULL | ONCHAIN | yes | Per-transaction cap. |
| `cumulative_cap_raw` | NUMERIC(78,0) NOT NULL | ONCHAIN | yes | Lifetime cap for the key. |
| `spent_raw` | NUMERIC(78,0) NOT NULL | ONCHAIN | **yes** (monotonic `spent`) | Read from module storage. |
| `max_slippage_bps` | INT NOT NULL | ONCHAIN | yes | Floor enforced onchain. |
| `valid_until` | TIMESTAMPTZ NOT NULL | ONCHAIN (`validUntil`) | yes | Hard expiry (N4). |
| `valid_after` | TIMESTAMPTZ NULL | ONCHAIN | yes | Optional start. |
| `registered_tx_hash` | BYTEA NULL | ONCHAIN-DERIVED | yes | The single user-signed UserOp that armed it. |
| `revoked_tx_hash` | BYTEA NULL | ONCHAIN-DERIVED | yes | Owner-only instant revoke. |
| `created_at` / `updated_at` | TIMESTAMPTZ | OFFCHAIN | n/a | |

### 10.1 Lifecycle — `session_key_status`

```text
(none) ──(one user-signed UserOp registers key)──▶ active
active ──(spent_raw ≥ cumulative_cap_raw)──▶ exhausted   # onchain rejects further ops
active ──(now ≥ valid_until)──▶ expired                  # onchain rejects (N4 / FR-032)
active ──(owner-only revokeSessionKey)──▶ revoked        # instant, unilateral (FR-031)
[expired|revoked|exhausted] ──(re-auth)──▶ new key (new row)
```

**Validation rules.**
- VR-SK1 (N4/FR-030/SC-008): the **onchain** `PolicyModule` is the authoritative enforcer; any op exceeding allowlist/selectors/caps/slippage/expiry is rejected onchain regardless of what the mirror says. The offchain mirror rejects out-of-scope **first** (defense in depth) but is never the sole gate.
- VR-SK2 (FR-031): `revoked` MUST be derivable purely from the owner's onchain revoke tx; revocation requires **no** SparkPoint cooperation. The mirror flips on indexing the revoke event but the chain state changes immediately at the tx.
- VR-SK3 (FR-029): registration MUST require exactly one user-signed UserOp; the model never stores or generates the session private key.
- VR-SK4: `allowlisted_targets ⊆ onchain protocol allowlist`; the mirror can never list a target the contract would not accept.

---

## 11. E11 — Execution / Transaction  *(OFFCHAIN intent → ONCHAIN-DERIVED result)*

A state-changing onchain action (deposit/withdraw/swap/rebalance) that carries a pre-trade simulation and requires a **user signature (or an in-scope session key)** to proceed. Split into the **intent** (what the agent proposed, offchain) and the **execution result** (what happened onchain, derived). The orchestrator emits only unsigned, inert, idempotent `IntentBundle`s and **holds no keys**.

**Table `intent_bundles`** *(the agent's unsigned proposal — OFFCHAIN)*

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | The `intent_action_id` minted at proposal time (attribution anchor). |
| `recommendation_id` | UUID NULL FK | Source recommendation (null for direct user-initiated actions). |
| `user_id` / `smart_account_address` | UUID / CITEXT | |
| `steps` | JSONB NOT NULL | Ordered steps: `{target, selector, calldata, value, asset, amount}` — **unsigned calldata only**. |
| `policy_verdict` | ENUM `policy_verdict` NOT NULL | `approved` \| `rejected` \| `blocked_simulation` \| `blocked_cap` \| `blocked_slippage` \| `blocked_allowlist`. |
| `policy_version` | TEXT NOT NULL | The exact ruleset that ran (provability/audit). |
| `policy_reasons` | JSONB NOT NULL | Per-check results (schema, allowlist, asset, caps, mandate, sim, kill-switch). |
| `simulation_result_id` | UUID NULL FK→simulation_results | Required for `approved` (FR-021). |
| `expires_at` | TIMESTAMPTZ NOT NULL | Short TTL; stale bundles are not signable. |
| `is_session_key_path` | BOOLEAN NOT NULL DEFAULT false | True if intended for an in-scope session key. |
| `created_at` | TIMESTAMPTZ | |

**Table `executions`** *(the result — OFFCHAIN record over ONCHAIN-DERIVED truth)*

| Field | Type | Onchain-reconstructable? | Notes |
|-------|------|--------------------------|-------|
| `id` | UUID v7 PK | n/a | |
| `intent_bundle_id` | UUID NOT NULL FK | n/a | |
| `smart_account_address` | CITEXT NOT NULL | yes | |
| `action_kind` | ENUM `action_kind` NOT NULL | yes | deposit/withdraw/swap/rebalance. |
| `signing_mode` | ENUM | n/a | `per_action_user_signature` (default) \| `session_key`. |
| `status` | ENUM `execution_status` NOT NULL | partial | See §11.1. |
| `userop_hash` | BYTEA NULL | yes | ERC-4337 UserOp hash. |
| `tx_hash` | BYTEA NULL | yes | Settlement tx. |
| `block_number` | BIGINT NULL | yes | |
| `gas_used` | NUMERIC NULL | yes | |
| `realized_amounts` | JSONB NULL | **yes** (from receipt/events) | Actual in/out, for sim-vs-real reconciliation. |
| `reverted_reason` | TEXT NULL | yes | If on-chain revert. |
| `intent_log_action_id` | BYTEA NULL | yes | `IntentLog` event id when emitted (preferred attribution). |
| `attribution_method` | ENUM | n/a | `intent_log` \| `heuristic_match` (records which was used — per research). |
| `created_at` / `updated_at` | TIMESTAMPTZ | n/a | |

### 11.1 Lifecycle — `execution_status`

```text
built ──(policy REJECT on bundle)──▶ policy_rejected      # no signature ever offered (FR-008/SC-001)
built ──(user declines / wallet rejects / timeout)──▶ declined   # no tx submitted (FR-024)
built ──(user signs / in-scope session key)──▶ submitted
submitted ──(mined ok)──▶ confirmed ──▶ indexed ──(write/update outcome_log)
submitted ──(reverted on-chain)──▶ reverted
submitted ──(dropped/replaced)──▶ dropped
```

**Validation rules.**
- VR-X1 (SC-001/FR-022): no `executions` row may reach `submitted` without either a recorded user signature event (per-action) or an in-scope, unexpired, unrevoked `session_key`. **No signature/key is ever stored** — only the event of having signed.
- VR-X2 (FR-021/SC-002): an `intent_bundle` with `policy_verdict='approved'` MUST reference a `simulation_result_id`; a bundle cannot be approved without a passing simulation.
- VR-X3 (FR-008/N-policy): if `policy_verdict != 'approved'`, the frontend MUST NOT render a signable artifact; the model represents this as `built → policy_rejected` with reasons returned to chat as an explanation, never a bundle.
- VR-X4 (FR-027/SC-006): every step's `target` MUST resolve to a whitelisted adapter/vault; there is no generic `call(arbitraryTarget)` step kind.
- VR-X5 (N1): no step may set a recipient to a SparkPoint-controlled address; recipients are forced to the user's account/EOA (verified offchain and onchain).
- VR-X6: `executions` are append-mostly; the onchain truth (`tx_hash`, events) is authoritative and re-derivable — the row is a convenience index, never the source for funds movement.

---

## 12. E12 — Simulation Result  *(OFFCHAIN, Tenderly snapshot)*

The mandatory pre-trade simulation previewed before the user signs (FR-021, SC-002). A frozen snapshot of the Tenderly simulation that backs the `ExecutionDrawer` preview and the policy approval.

**Table `simulation_results`**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | |
| `intent_bundle_id` | UUID NOT NULL FK | |
| `simulator` | ENUM | `tenderly` (primary). |
| `sim_block` | BIGINT NOT NULL | Block the sim was run against (freshness anchor). |
| `will_revert` | BOOLEAN NOT NULL | If true → action blocked from signing (FR-023). |
| `revert_reason` | TEXT NULL | Shown to user on block. |
| `expected_out_raw` | NUMERIC(78,0) NULL | Expected output amount. |
| `expected_fees_raw` | NUMERIC(78,0) NULL | |
| `price_impact_bps` | INT NULL | |
| `estimated_slippage_bps` | INT NULL | Compared against `min(mandate.max_slippage, session_key.max_slippage, hard_ceiling)`. |
| `balance_deltas` | JSONB NOT NULL | Per-asset deltas rendered in the drawer. |
| `passed` | BOOLEAN NOT NULL | Composite: `!will_revert AND slippage ≤ max`. |
| `raw_sim_ref` | TEXT NULL | Tenderly sim id (provenance; not custody-critical). |
| `created_at` | TIMESTAMPTZ | |

**Validation rules.**
- VR-S1 (FR-023): `will_revert=true` OR `estimated_slippage_bps > max` ⇒ `passed=false` ⇒ bundle cannot be `approved` ⇒ no signature offered; the user is told why.
- VR-S2 (freshness): `sim_block` MUST be within the staleness tolerance at sign time; a sim older than tolerance forces a re-simulate before signing (no execution on stale data).
- VR-S3 (SC-002): a `passed` simulation MUST exist and be displayed before 100% of signature requests; the drawer renders `balance_deltas` + the guardrail checklist.

---

## 13. E13 — Outcome Log Entry  *(ONCHAIN-DERIVED PnL over an OFFCHAIN link)*

The credibility loop: a record linking an acted-upon recommendation → its resulting position/action → **realized PnL over time** (FR-039/040/041, SC-010). The link is offchain; the PnL is onchain-reconstructable.

**Table `outcome_logs`**

| Field | Type | Onchain-reconstructable? | Notes |
|-------|------|--------------------------|-------|
| `id` | UUID v7 PK | n/a | |
| `recommendation_id` | UUID NOT NULL FK | n/a | The advised action (provability link). |
| `intent_bundle_id` | UUID NOT NULL FK | n/a | The proposed bundle. |
| `execution_id` | UUID NOT NULL FK | n/a | The fulfilling execution. |
| `smart_account_address` | CITEXT NOT NULL | yes | |
| `entry_block` | BIGINT NOT NULL | yes | Block the position was opened. |
| `entry_price_snapshot_id` | UUID NOT NULL FK→price_snapshots | yes | Frozen entry mark. |
| `entry_cost_basis_raw` | NUMERIC(78,0) NOT NULL | **yes** (event replay) | Average-cost basis at entry. |
| `linked_position_id` | UUID NULL FK→indexed_positions | yes | Resulting position. |
| `realized_pnl_raw` | NUMERIC(78,0) NOT NULL DEFAULT 0 | **yes** | Updated over time as value changes/closes (FR-040). |
| `unrealized_pnl_raw` | NUMERIC(78,0) NULL | **yes** (mark w/ snapshot) | Mark-to-snapshot while open. |
| `realized_apy_bps` | INT NULL | yes | Annualized realized return for the advice. |
| `label` | ENUM `outcome_label` NULL | n/a | `open` \| `win` \| `loss` \| `flat` — surfaced to user (wins + losses). |
| `attribution_method` | ENUM | n/a | `intent_log` \| `heuristic_match` (which linkage was used). |
| `intent_action_id` | BYTEA NULL | yes | The id minted at proposal time / `IntentLog`. |
| `context_snapshot_id` | UUID NULL FK→context_snapshots | n/a | Frozen world at proposal (training label join). |
| `last_marked_block` | BIGINT NULL | yes | Last PnL refresh. |
| `created_at` / `updated_at` | TIMESTAMPTZ | n/a | |

### 13.1 Lifecycle — `outcome_label`

```text
(executed) ──(create entry)──▶ open
open ──(periodic mark / partial close)──▶ open (realized_pnl_raw, unrealized_pnl_raw refreshed)
open ──(position fully closed, pnl > tolerance)──▶ win
open ──(position fully closed, pnl < -tolerance)──▶ loss
open ──(position fully closed, |pnl| ≤ tolerance)──▶ flat
```

**Validation rules.**
- VR-O1 (FR-039/SC-010): exactly one `outcome_log` MUST be created for every `executed` recommendation; no acted-upon recommendation may lack one.
- VR-O2 (FR-040): `realized_pnl_raw` MUST be updated over time from onchain events + price snapshots; the value is **reconstructable** — never a manual or model-asserted figure.
- VR-O3 (attribution): linkage prefers a dedicated `IntentLog` event (`attribution_method='intent_log'`); fallback is deterministic `(sender, target, selector, asset, amount, block window)` matching (`heuristic_match`). The method used MUST be recorded for auditability.
- VR-O4 (FR-041): both wins and losses MUST be viewable to the user (no survivorship filtering).

---

## 14. E14 — Literacy Tip  *(OFFCHAIN)*

Contextual financial-education snippets surfaced relevant to the user's current action/context (FR-007), plus impression tracking for relevance tuning.

**Table `literacy_tips`**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | |
| `slug` | TEXT UNIQUE NOT NULL | Stable reference. |
| `title` | TEXT NOT NULL | |
| `body_md` | TEXT NOT NULL | Markdown snippet. |
| `trigger_context` | ENUM[] NOT NULL | e.g., `{onboarding, vault_deposit, aave_supply, swap, slippage, session_key, withdraw}`. |
| `related_action_kind` | ENUM NULL | Maps to `action_kind`. |
| `embedding_id` | UUID NULL FK→memory_chunks | For semantic surfacing via pgvector. |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Table `literacy_tip_impressions`**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | |
| `tip_id` | UUID NOT NULL FK | |
| `user_id` | UUID NOT NULL FK | |
| `context` | ENUM NOT NULL | Where it was shown. |
| `shown_at` | TIMESTAMPTZ NOT NULL | |
| `dismissed` / `expanded` | BOOLEAN | Engagement signals. |

**Validation rules.**
- VR-LT1: tips are informational only — surfacing a tip MUST never gate, delay, or alter a custody-critical flow.
- VR-LT2: semantic surfacing uses `memory_chunks` similarity but MUST respect `trigger_context` as a hard filter (no off-context tips during signing).

---

## 15. E15 — Beta Whitelist Entry  *(OFFCHAIN)* and E16 — Audit Log  *(OFFCHAIN, append-only)*

### 15.1 `beta_whitelist`  *(OFFCHAIN gate — app access only, never the onchain escape hatch)*

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | |
| `eoa_address` | CITEXT UNIQUE NOT NULL | Whitelisted signer. |
| `status` | ENUM `whitelist_status` NOT NULL | `invited` \| `enabled` \| `revoked`. |
| `per_user_cap_raw` | NUMERIC(78,0) NOT NULL | Display/UX cap; **the binding cap is onchain** (`CapRegistry`). |
| `geo_allowed` | BOOLEAN NOT NULL DEFAULT true | Region eligibility for app surfaces (FR-044). |
| `invited_by` | TEXT NULL | Provenance. |
| `enabled_at` / `revoked_at` | TIMESTAMPTZ NULL | |
| `notes` | TEXT NULL | |

**Lifecycle — `whitelist_status`**: `invited → enabled → revoked` (revoked blocks **app** transacting only).

**Validation rules.**
- VR-W1 (FR-042/SC-014): only `enabled` + `geo_allowed` entries may transact through the app; non-whitelisted/geo-blocked users are prevented from app surfaces.
- VR-W2 (N2/SC-014): `revoked`/geo-blocked/`disabled` users **retain** the onchain withdraw-always escape hatch; no whitelist state may be a precondition for `/exit`. The binding per-user/total caps live onchain (`CapRegistry`); this table is a UX mirror.

### 15.2 `audit_logs`  *(append-only; the provability/forensics spine)*

Records every policy verdict, cap check, kill-switch read, simulation, signature event, session-key registration/revoke, and admin/governance action — supporting "Provable, not promised" and post-hoc verification. **Append-only** (no UPDATE/DELETE; enforced by trigger + restricted grants).

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | |
| `ts` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `actor_kind` | ENUM | `user` \| `agent` \| `coordinator` \| `policy_layer` \| `indexer` \| `governance` \| `system`. |
| `actor_ref` | TEXT NULL | EOA/account/agent name (no secrets). |
| `event_type` | ENUM | `policy_verdict` \| `cap_check` \| `killswitch_read` \| `simulation` \| `signature_requested` \| `signature_recorded` \| `session_key_registered` \| `session_key_revoked` \| `recommendation_emitted` \| `mandate_confirmed` \| `governance_pause` \| `risk_event`. |
| `subject_table` / `subject_id` | TEXT / UUID | The row this concerns. |
| `policy_version` | TEXT NULL | Ruleset in effect (where applicable). |
| `payload` | JSONB NOT NULL | Structured detail (reasons, caps, blocks, hashes) — **no keys/signatures**. |
| `onchain_ref` | BYTEA NULL | tx/userop hash when applicable. |
| `hash_prev` / `hash_self` | BYTEA NULL | Optional hash-chain for tamper-evidence. |

**Validation rules.**
- VR-A1: `audit_logs` is append-only; the model MUST forbid UPDATE/DELETE (trigger-enforced) so the record is tamper-evident.
- VR-A2 (SC-001/004/006): every `signature_requested`, `policy_verdict`, and `cap_check` on a state-changing action MUST produce an audit row; the absence of an audit row for an executed action is itself a flagged anomaly.
- VR-A3: `payload` MUST never contain private keys, signatures, or session private keys (only their *existence*/hashes).

---

## 16. Supporting Tables (indexing, pricing, memory, health, Trust Center)

These exist to make the ONCHAIN-DERIVED entities reconstructable and to power RAG, while never being on the custody/withdrawal path.

| Table | Layer | Purpose / key fields |
|-------|-------|----------------------|
| `onchain_events` | ONCHAIN-DERIVED (raw) | Canonical indexed log feed: `(tx_hash, log_index)` UNIQUE, `address`, `topic0`, `decoded` JSONB, `block_number`, `removed` (reorg). The substrate every derived value is rebuilt from. |
| `price_snapshots` | ONCHAIN-DERIVED canon | Block-anchored price marks: `asset`, `block_number`, `price_quote_raw`, `source` (`chainlink_base` canonical; `http_api` long-tail display-only, flagged), `confidence`. Every displayed number cites one (VR-P3). |
| `context_snapshots` | OFFCHAIN snapshot | Frozen world at proposal time: portfolio summary, mandate version, market conditions, rationale inputs. Joined to `outcome_logs`/`risk_events` to form the labeled training dataset (RAG, not fine-tuning). |
| `risk_events` | ONCHAIN-DERIVED / OFFCHAIN labels | Detected anomalies: owner mismatch (VR-U3/SA1), impl change (VR-SA2), cap breach attempt, oracle staleness, large drawdown — feeds learning + Trust signals. |
| `chat_messages` | OFFCHAIN | `(user_id, seq)` ordered conversation; `role`, `content`, `card_payloads` JSONB (typed, Zod-validated), `policy_stamp`. Source of mandate provenance and recommendations. |
| `memory_chunks` | OFFCHAIN (**pgvector**) | RAG store — see §17. |
| `data_source_health` | OFFCHAIN | Per-source liveness/staleness (`rpc`, `subgraph_aave`, `subgraph_aero`, `dune`, `defillama`, `chainlink`, `tenderly`); drives `is_stale` marking and "no execution on stale data" (FR-stale). |
| `indexer_cursors` | OFFCHAIN | Per-stream `last_processed_block`, confirmation lag, reorg watermark. |
| `permission_manifests` | ONCHAIN (cache of chain reads) | Trust Center "prove-it": exact `owner`, validators, allowlisted targets/selectors, caps, expiries, pauser roles, vault impl/proxy-slot emptiness — each row linkable to BaseScan (FR-038/SC-012/SC-004). Always re-read from chain on render; cache is convenience only. |
| `srk_view` | ONCHAIN-DERIVED display | Non-gating SRK info (balance, links). MUST NOT be referenced by any core-function gate (FR-045/046, SC-013). |

**Authority/staleness rules (apply to all of §6–§13 derived values).**
- VR-DS1: **RPC > subgraph > Dune > HTTP price API.** Any value feeding a pre-sign gate (caps, slippage, vault state, balances) is read **fresh from RPC at decision time**; cached Postgres values are display-only.
- VR-DS2: when `data_source_health` marks a source degraded beyond tolerance, dependent positions/recommendations are marked `is_stale` and **no execution proceeds on stale data** beyond the user's tolerance; custody/withdrawals are unaffected.
- VR-DS3: indexing is idempotent and reorg-safe (`(tx_hash, log_index)` unique; `removed`/confirmation-lag rollback). Reconstruction of any ONCHAIN-DERIVED value from `onchain_events` + `price_snapshots` MUST be deterministic.

---

## 17. pgvector Embedding Use

`memory_chunks` is the single pgvector store powering the retrieval-augmented learning loop (RAG over outcomes, **not** weight-updating at launch — plan Layer 4).

**Table `memory_chunks`**

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID v7 PK | Referenced by `*.embedding_id` across tables. |
| `user_id` | UUID NULL FK | Null for global/shared knowledge (e.g., literacy corpus). |
| `source_kind` | ENUM `memory_source` NOT NULL | `chat_message` \| `mandate` \| `goal` \| `recommendation` \| `outcome_log` \| `context_snapshot` \| `literacy_tip` \| `risk_event`. |
| `source_id` | UUID NOT NULL | Row the chunk derives from. |
| `content` | TEXT NOT NULL | The chunked text that was embedded. |
| `embedding` | `vector(N)` NOT NULL | Pinned embedding model + dimension `N` (per research — model is version-pinned for reproducibility). |
| `embedding_model` | TEXT NOT NULL | Exact model id/version that produced the vector. |
| `metadata` | JSONB NOT NULL | Filterable scope: `risk_tier`, `action_kind`, `outcome_label`, `protocol`, `as_of_block`. |
| `created_at` | TIMESTAMPTZ | |

**Index & usage.**
- ANN index: `ivfflat`/`hnsw` on `embedding` with cosine distance; metadata B-tree/GIN for pre-filtering (`user_id`, `source_kind`, `risk_tier`, `outcome_label`).
- **Retrieval surfaces**: (a) recommender retrieves similar **past outcomes** (wins+losses) scoped to the user's `risk_tier` to ground rationale in what actually worked; (b) assistant retrieves relevant **literacy tips** by semantic + `trigger_context` match (VR-LT2); (c) mandate/goal recall for continuity across sessions; (d) similar-context lookup for `context_snapshots` to inform scoring.

**Validation rules.**
- VR-E1: `embedding_model` and dimension `N` are **pinned**; mixed-model vectors MUST NOT share an ANN index (re-embed on model change — provability/reproducibility).
- VR-E2 (custody safety): embeddings/RAG are **advisory** — retrieval output is an input to AI reasoning, which is still wrapped by the deterministic policy layer; nothing retrieved can authorize an out-of-policy or out-of-allowlist action (Constitution II).
- VR-E3: `memory_chunks` MUST NOT store secrets, raw keys, or signed payloads.

---

## 18. Onchain-Reconstructability Summary (Provable Performance)

Fields below are **fully reconstructable** by replaying Base history (`onchain_events`) + the block-anchored `price_snapshots`; Postgres is an accelerator only. This is what makes performance *provable, not promised* (Constitution III; SC-003/004/011/012).

| Reconstructable value | Built from |
|-----------------------|-----------|
| Smart-account owner, validators, impl | account/factory reads + events (VR-SA1/2) |
| Vault `totalAssets`, `totalSupply`, share price, 0% mgmt/entry/exit/principal, non-upgradeable | vault reads + ERC-4626 events + EIP-1967 slot emptiness (VR-V1) |
| Performance fee: rate (≤20%), realized yield above HWM, fee shares minted to non-privileged `feeRecipient`, HWM advances | `fee_events` replay + ERC-4626 events + HWM-advance events (VR-FE1–5) → fee provable on-chain, principal never reduced |
| User vault-share balance & redeemable assets | `vault_share_events` replay (VR-VP2) → withdraw-always provable offline |
| Aave supply balance & accrued yield | aToken balance/index over time |
| Position cost basis (average-cost), realized & unrealized PnL | deposit/swap/withdraw events + entry/mark `price_snapshots` |
| Portfolio total value & allocation | sum of positions at a single block-anchored snapshot |
| Recommendation → realized PnL (outcome) | `IntentLog`/heuristic linkage + position PnL replay (VR-O2/3) |
| Session-key scope, `spent`, expiry, revocation | `PolicyModule`/`SessionKeyValidator` storage + register/revoke events (VR-SK1/2) |
| Caps, kill-switch (pause) status, permission manifest | `CapRegistry`/`KillSwitch` reads + exact permission reads (Trust Center, SC-012) |

**Explicitly NOT onchain (OFFCHAIN-only, by design):** chat content, mandate/goal text + risk score, recommendation rationale/score/citations, simulation snapshots, literacy tips, whitelist/geo, audit log, embeddings, data-source health, context snapshots. None of these are on the custody or withdrawal path; losing all of Postgres degrades product intelligence but **cannot** trap funds or block withdrawal (N2).

---

## 19. Cross-Cutting Invariant Mapping (data-model view)

| Invariant / Principle | Enforced in the data model by |
|----------------------|-------------------------------|
| **N1 — No admin withdrawal** | VR-X5 (no SparkPoint recipient), VR-SA1 (no non-owner asset capability), VR-V1b/VR-FE1 (fee on realized yield above HWM only — never principal; `feeRecipient` is a non-privileged holder), audit of every recipient; no schema field can express a SparkPoint withdrawal recipient. |
| **N2 — Withdraw-always** | VR-V2, VR-VP2, VR-W2, VR-FE3 (fee accrual fail-open — never blocks/delays/reverts a redemption): pause/whitelist/geo never gate withdraw; share balance reconstructable from events with Postgres offline. |
| **N3 — User-owned keys** | VR-SA1/U3 (`owner == user EOA`), no keystore fields anywhere, VR-X1/SK3 store the *event* of signing, never a key. |
| **N4 — Scoped, revocable automation** | `session_keys` mirrors onchain scope; VR-SK1/2/4 keep onchain authoritative + revoke unilateral. |
| **N5 — Non-upgradeable + verifiable** | VR-V1 (0% mgmt/entry/exit, non-upgradeable checks), VR-V1a (performance-fee rate is the only mutable param — timelocked, hard-capped at 20%, never alters custody semantics), `permission_manifests` for provable permissions. |
| **AI never final word** | `intent_bundles.policy_verdict`/`policy_version`, VR-X2/3, VR-E2: nothing signable without independent policy approval + simulation. |
| **Provable, not promised** | §18 reconstructability, `price_snapshots` citation requirement (VR-P3), append-only `audit_logs`. |

---

## 20. Open Items Deferred to Research / Tasks

- Exact embedding model id + dimension `N` (pinned in `research.md`); `ivfflat` vs `hnsw` parameters tuned in tasks.
- `IntentLog` event final shape vs heuristic fallback thresholds (`attribution_method`) — finalized with `contracts/`.
- Price canon edge cases for ETH/long-tail display (Chainlink-on-Base vs HTTP), confidence thresholds for `price_snapshots.source`.
- Reorg confirmation-lag value per stream (`indexer_cursors`).
- Cost-basis method confirmed as **average-cost** for MVP (FIFO deferred).
