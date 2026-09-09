# Data Model: Wrapper Vault Factory (Phase 1–4)

> **GATE.** Every shape below is DESIGN ONLY and MUST NOT be built until the Phase-0 constitution
> amendment is ratified by the operator (super-majority re-ratification). See
> [`plan.md`](./plan.md) Constitution Check and [`tasks.md`](./tasks.md) T001. This document describes the
> on-chain storage, the factory registry, the curated Morpho allowlist, and the in-app rows that the
> companion **010 Universal Vaults** registry/reader consumes — none of which may be authored pre-ratification.

This feature adds one new on-chain contract family (a template + a factory) and a small amount of off-chain
provenance state. The 010 read/advisory half owns the **static-config registry** (`AddressBook.vaults[]` +
`config.py`; **no DB table**) + the generic vault reader; **011 is the write/execution half** — it owns a NEW
runtime store (a 011 migration: the curated-allowlist table + a `sparkpoint_wrappers` provenance table) and
extends the 010 reader to merge those factory-created rows. Field notes call out the invariants
(N1 no-admin-withdrawal, N2 withdraw-always, N5 single-purpose non-upgradeable) that Foundry tests (US2)
MUST enforce.

---

## 1. `SparkPointMorphoVault` — on-chain (contract storage)

A clone (by SOURCE, not by `delegatecall`) of `contracts/src/vault/SparkPointVault.sol` with the Aave leg
swapped for a single curated `IERC4626 morphoVault`. **Full-bytecode CREATE2 deploy** (not a minimal-proxy
clone) so N5's "no `delegatecall`-to-impl" holds. New source file:
`contracts/src/vault/SparkPointMorphoVault.sol`. Interface:
[`contracts/vault-factory-interfaces.md`](./contracts/vault-factory-interfaces.md) §1.

### Immutables (set once in the constructor — cannot change ⇒ N5)

| Field | Type | Notes |
|---|---|---|
| `asset` (`USDC`) | `IERC20` immutable | The ERC-4626 underlying. Same 6-dp USDC as the launch vault. |
| `MORPHO_VAULT` | `IERC4626` immutable | The single curated Morpho wrapper this instance routes into. **Exactly one**, set at deploy, on the factory allowlist at deploy time (§4). No setter ⇒ single-purpose. |
| `FACTORY` | `address` immutable | The deploying `SparkPointVaultFactory`. Provenance only; the factory has **no** fund path into the instance. |
| `guardian` | `address` immutable | OZ `TimelockController` (same governance spine as the launch vault; pause-DEPOSITS-only). |
| `capRegistry` | `address` immutable | Per-instance `CapRegistry` (reuses `contracts/src/governance/CapRegistry.sol`); caps adjustable via guardian-timelock only, never a fund path. |
| `feeRecipient0` | `address` immutable-seed | Initial fee-share recipient (SparkPoint treasury). Mutable thereafter via timelock (see below); still an ORDINARY non-privileged holder. |
| `MAX_PERFORMANCE_FEE_BPS` | `uint16` constant | `2000` (20%) — bytecode constant, governance can NEVER exceed (Constitution V). |

### Mutable state (the ONLY writable params — none touch custody/withdraw/principal)

| Field | Type | Notes |
|---|---|---|
| `performanceFeeBps` | `uint16` | Default `1000` (10%); timelocked; `≤ MAX_PERFORMANCE_FEE_BPS`. Profit-only, HWM-gated. |
| `highWaterMark` | `uint256` | Share price (assets-per-share, 1e18-scaled). **Constructor-seeded** to `convertToAssets(1e18)` so the first `accrueFee()` can never tax principal (same FR-050 seeding as the launch vault). Monotonic up; never `< 1e18`. |
| `feeRecipient` | `address` | Timelocked setter; always a non-privileged holder redeemable via the normal withdraw path. |
| `paused` | `bool` | PAUSE-DEPOSITS-ONLY. `withdraw`/`redeem` carry NO `whenNotPaused` (N2). |

### Derived views (NON-rebasing — the key difference from the Aave leg)

| View | Definition | Invariant note |
|---|---|---|
| `totalAssets()` | `MORPHO_VAULT.convertToAssets(MORPHO_VAULT.balanceOf(address(this)))` | Morpho MetaMorpho shares are **NON-rebasing** — the wrapper's aUSDC-style `balanceOf`-grows assumption does NOT hold; value accrues via `convertToAssets` price, not balance growth. US2 fuzz MUST prove `totalAssets()` tracks the Morpho share price, incl. a Morpho-side loss. |
| `maxWithdraw(owner)` | `min(ERC4626-derived, MORPHO_VAULT.maxWithdraw(address(this)))` | **Clamp to Morpho liquidity** so the partial-exit assertion holds under partial Morpho liquidity. ⚠️ Morpho **Vaults V2** `max*` return `0` — when the wrapped vault is V2, availability is derived from the market's liquid assets, not `maxWithdraw` (see [`contracts/vault-factory-interfaces.md`](./contracts/vault-factory-interfaces.md) §1.3 + [`research.md`](./research.md)). |
| `maxRedeem(owner)` | shares equivalent of the clamped `maxWithdraw` | Same clamp; N2 escape hatch still lets the user pull whatever Morpho liquidity exists, right now, without SparkPoint. |

### Custody invariants this shape MUST satisfy (US2 re-proves each)

- **N1 (no admin withdrawal)**: no `sweep`/`migrate`/`rescue`/`skim`/`recoverERC20`; `feeRecipient`/`guardian`/`factory` have NO code path that moves a user's shares or the wrapped Morpho position to a SparkPoint address. The ONLY asset egress is a user-signed `withdraw`/`redeem` to the user's own `receiver`.
- **N2 (withdraw-always)**: `withdraw`/`redeem` NEVER revert on `paused`; NEVER depend on `accrueFee()` success (fail-open fee leg); succeed while the factory/guardian/SparkPoint backend are offline, up to the live Morpho liquidity.
- **N5 (single-purpose, non-upgradeable)**: no proxy, no `upgradeTo`, no EIP-1967 slots, no `delegatecall`-to-impl; `MORPHO_VAULT` is immutable (one protocol target, forever); the instance can interact with exactly one curated Morpho vault and USDC — nothing else, by construction.

---

## 2. `SparkPointVaultFactory` — on-chain (contract storage)

Admin-gated deploy-only registrar. **Holds no funds** (no `receive`, no token custody, no fund path). New
source file: `contracts/src/factory/SparkPointVaultFactory.sol`. Interface:
[`contracts/vault-factory-interfaces.md`](./contracts/vault-factory-interfaces.md) §2.

| Field | Type | Notes |
|---|---|---|
| `owner` | `address` | The admin gate for `createVault` + `allowlistMorphoVault`. SHOULD be the OZ `TimelockController` (same governance spine), NOT an EOA. |
| `morphoAllowlist` | `mapping(address ⇒ bool)` | On-chain curated allowlist. `createVault` reverts if `MORPHO_VAULT` not allowlisted ⇒ "interaction with any other protocol is impossible by construction" is preserved AT THE FACTORY BOUNDARY per the ratified amendment. |
| `vaults` | `address[]` | Every deployed wrapper, in deploy order. Read by `vaults()` / `vaultAt` / `vaultsLength`. |
| `isSparkPointVault` | `mapping(address ⇒ bool)` | O(1) provenance check — 010's reader trusts an instance only if the factory attests it. |
| `deployedSalt` | `mapping(bytes32 ⇒ bool)` | CREATE2 salt-used guard (idempotent deploy; predictable address via `predictVaultAddress`). |

Invariants: the factory has **no** `deposit`/`withdraw`/`sweep`/`transfer` surface; removing an entry from
`morphoAllowlist` does NOT and CANNOT touch any already-deployed instance's immutable `MORPHO_VAULT`
(de-allowlisting only blocks FUTURE deploys — an existing wrapper's users keep their N2 escape hatch).

---

## 3. Curated allowlist entry (on-chain mapping ↔ off-chain vetting record)

The on-chain `morphoAllowlist[addr] = true` is the ENFORCEMENT; an off-chain row carries the human vetting
rationale that gated the operator's decision to allowlist. Off-chain row (new table — see §5):

| Field | Type | Notes |
|---|---|---|
| `morpho_vault` | `address` | The curated `IERC4626` (MetaMorpho V1.1 or Vaults V2). |
| `chain_id` | `int` | `8453` (curated mainnet vaults) / `84532` (self-created test vault). Morpho API/app are **mainnet-only** (see [`quickstart.md`](./quickstart.md)). |
| `curator` | `text` | The Morpho vault's on-chain curator/owner (who sets its NATIVE fee). Recorded for the honest **double-fee** disclosure (III). |
| `native_fee_bps` | `int` | The wrapped vault's own Morpho curator/mgmt fee — DISCLOSED so the stacked fee is honest (III). |
| `vetting_notes` | `text` | Why it was allowlisted (TVL, audit, oracle, market composition). |
| `allowlisted_tx` | `text` | The `allowlistMorphoVault` tx hash (on-chain provenance). |
| `status` | enum `pending \| allowlisted \| revoked` | Mirrors the on-chain mapping; `revoked` blocks new deploys only. |

---

## 4. Wrapper-provenance rows the factory writes (`sparkpoint_wrappers`, read by the 010 reader)

The companion **010 Universal Vaults** owns the **static-config registry** (`AddressBook.vaults[]` +
`config.py`; no DB table) + the generic vault reader (see `specs/010-universal-vaults/data-model.md`).
Factory-created wrappers are minted at RUNTIME, so they cannot live in 010's compile-time static config;
instead **011 owns the `sparkpoint_wrappers` provenance table** (below) and extends the 010 reader to merge
those dynamic rows with the static registry. 011 is the WRITER: when the operator runs `createVault`, the
admin flow (§ Phase 3) inserts a `sparkpoint_wrappers` row the read-only `/admin/vaults` panel + reader render.

| Field | Type | Owner | Notes |
|---|---|---|---|
| `vault_address` | `address` | 010 | The deployed wrapper (CREATE2). Primary identity for the reader. |
| `chain_id` | `int` | 010 | Network of the instance. |
| `kind` | enum `aave_launch \| morpho_wrapper` | **011** | Distinguishes the conservative launch vault (default) from a branded wrapper. The launch vault stays `aave_launch` + default. |
| `label` | `text` | **011** | Branded display name passed to `createVault(...label)` (e.g. "SparkPoint · Steakhouse USDC"). |
| `morpho_vault` | `address?` | **011** | The wrapped curated vault (null for `aave_launch`). Joins to §3. |
| `perf_fee_bps` | `int` | 010 (read on-chain) | Live from the instance `performanceFeeBps()` — reader is the source of truth, this column is a cache. |
| `native_fee_bps` | `int?` | **011** | The wrapped Morpho fee, for the **stacked double-fee** disclosure (III). |
| `deploy_tx` | `text` | **011** | CREATE2 deploy tx hash (provenance). |
| `factory_address` | `address` | **011** | The `SparkPointVaultFactory` that attests this instance (`isSparkPointVault`). 010's reader MUST verify provenance against this before rendering. |
| `created_at` | `timestamptz` | **011** | Deploy time. |

**Reader contract (010 ↔ 011).** A `SparkPointMorphoVault` registers with `abiKind:'sparkpoint'` — it exposes
the full SparkPoint superset (`previewDeposit/Redeem`, `convertTo*`, `totalAssets`, `asset`, `balanceOf`,
`paused`, `performanceFeeBps`, `highWaterMark`, `feeRecipient`), so it passes 010's **split** reader against
the `_ERC4626_CORE_METHODS` + `_SPARKPOINT_EXTRA_METHODS` sets (see `specs/010-universal-vaults/data-model.md`
§2) by construction. Because the wrapper is ABI-compatible AND carries verified `factory_address` provenance,
**it appears in the 010 registry/reader automatically** (US5) once its `sparkpoint_wrappers` row exists.
`morphoVault()` is an ADDITIVE view the reader may optionally surface; it is in neither method set, so 010
needs no ABI change to list a wrapper.

---

## 5. Off-chain migrations & in-app shapes

### Migration (new — owned by 011)

`services/agent/migrations/` — 011 owns a single NEW migration, `0016_vault_factory.sql` (confirm the next
free number at implementation time; the repo max on `develop` is `0014`, and a parallel feature may claim
`0015`). It CREATES two 011-owned tables: `morpho_curated_allowlist` (§3) and `sparkpoint_wrappers` (§4:
`vault_address`, `chain_id`, `kind`, `label`, `morpho_vault`, `native_fee_bps`, `deploy_tx`,
`factory_address`, `created_at`). **010 introduces no DB table** — its registry is static config
(`AddressBook.vaults[]`), so there is nothing for 011 to ALTER; 011 instead extends the 010 reader to merge
these runtime rows. Apply with `PGCLIENTENCODING=UTF8` (repo migration gotcha).

### Web `VaultDescriptor` (extended — `apps/web/src/lib/chain/useVault.ts`)

`useVault.ts` today resolves a SINGLE `vaultAddressFor(chainId)` + a fixed `sparkPointVaultAbi` (USDC 6dp
hardcoded). US5 generalizes it to resolve BY `vaultAddress` (multi-vault), keyed on the 010 registry:

| Field | Change | Notes |
|---|---|---|
| `vaultAddress` | now a param, not a singleton | The instance to read/deposit into. Launch vault remains the default. |
| `kind` | NEW | `'aave_launch' \| 'morpho_wrapper'` — drives copy (Aave vs external Morpho) + the double-fee disclosure. |
| `label` | NEW | Branded name from the registry (replaces the hardcoded "Aave Yield Vault"/spkUSDC strings in `useVaultConfirm.tsx` for wrapper instances). |
| `underlyingProtocol` | NEW | `'aave_v3' \| 'morpho'` — honest venue label; wrapper MUST state yield is NOT Aave (III). |

### Portfolio derive union (extended — `apps/web/src/lib/portfolio/derive.ts`)

Today a CLOSED `'vault' | 'idle'` union (single vault). US5 widens the `'vault'` arm to carry a
`vaultAddress` + `label` so multiple branded wrappers + the launch vault coexist in one portfolio view.
This is an additive discriminant, NOT a policy change.

### Admin manage view-model (new — `apps/web/src/app/admin/vaults/page.tsx`)

The MANAGE half of the unified `/admin/vaults` page (010 built the READ half — see
`specs/010-universal-vaults/` US3). Client-side view-model rows: `{ vault, label, kind, paused, guardian,
performanceFeeBps, feeRecipient, caps, morphoVault, nativeFeeBps }` — all read live from the instance +
registry. Guardian actions (pause / setFee / setFeeRecipient / adjust caps) render as **prepared Timelock
calldata** the operator signs off-app (mirrors the read-only killswitch pattern in
`apps/web/src/app/admin/killswitch/page.tsx`); **no server-held key, no in-app fund path** — the "no
move-funds action exists" invariant is visible AND enforced (US4).

---

## 6. Policy-layer shapes (UNCHANGED — recorded for the Constitution Check)

- `services/agent/src/sparkpoint_agent/policy/enums.py` `Protocol` enum + its TS mirror
  `packages/shared/src/policy/enums.ts` — **NOT widened** by 011. A user-signed deposit into a branded
  wrapper is OUTSIDE the deterministic policy engine (same posture as 007's user-signed swap). The agent's
  custodied-execution allowlist (`aave_v3`, `aerodrome`, `sparkpoint_vault`) is untouched. The ratified
  amendment extends **Guardrail IV.5's whitelist** for USER-SIGNED branded wrappers, NOT the policy engine's
  `(target, selector)` permission set. This mirrors 007 FR-024 ("no widening of the policy allowlist / Asset
  enum / (target,selector) permissions").
- `packages/shared/src/addresses/*` — the factory + curated-vault addresses are recorded per chain as plain
  address-book fields (like 007's `swapFeeRecipient?`), NOT as policy `TargetRef`s (no `TARGET_REF_FIELD` /
  T098 parity impact).
