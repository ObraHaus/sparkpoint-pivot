# Feature Specification: Multi-Protocol Vaults — Morpho Vault V2 Fee Wrappers + the Vault Registry

**Feature Branch**: `feat/024-multi-protocol-vaults`

**Created**: 2026-07-30

**Status**: Draft — **BLOCKED on constitution v3.0.0 ratification** (see
`constitution-amendment-v3.0.0.md` in this directory). Phase 0 (the retirement) and the advisory half
of Phase 2 are explicitly **not** blocked; see §Phasing.

**Input**: Operator-directed. The operator read
[docs.morpho.org/curate/tutorials-v2/vault-creation](https://docs.morpho.org/curate/tutorials-v2/vault-creation/)
and concluded that "our current implementation of morpho vault that just wraps other vault is
incorrect and we need to curate", noting there is also a Morpho vault on the Robinhood chain, and
asked how to make the SparkPoint vault support **Aave and Morpho vaults on Base (mainnet and testnet)
and Morpho vaults (mainnet and testnet)**.

A full findings + options report was produced first (artifact
`3c243ca2-f39b-4a31-b3fb-6ae446c21e3a`, 2026-07-30). The operator then chose, explicitly:

| Decision | Choice |
|---|---|
| **D1** — where user money sits | **Registry + Fee Wrapper** (not passthrough-only; not full curation) |
| **D2** — Base mainnet child | **List both** Steakhouse Prime USDC and Gauntlet USDC Prime, let users choose |
| **D3** — Robinhood Chain | **Ratify chain 4663 and ship the USDG vault** |
| Immediate work | **Retire the tamperable mock now** + **draft this spec and the amendment** |

Migration `0026` (the registry tables) was **not** selected for this pass and is specified here but
left unimplemented.

---

## Context & Framing

### What is wrong today

`SparkPointMorphoVault` (455 lines, `contracts/src/vault/SparkPointMorphoVault.sol`) is a bespoke
ERC-4626 that wraps exactly one other ERC-4626. The operator is right that it is the wrong shape, but
the sharpest reason is not "it wraps instead of curating" — it is that **Morpho already ships this
exact configuration, audited, and calls it a Fee Wrapper**:

> "A **Fee Wrapper** is a Vault V2 configured in a specific, constrained mode that enables
> distribution channels to add a fee layer on top of an existing Morpho Vault V2… **Immutably bound**
> to a single Morpho Vault V2 at deployment. Can **not** be changed… Risk management functions are
> abdicated, making operation simpler."
> — docs.morpho.org/developers/earn/concepts/fee-wrapper, whose listed use cases include
> "**White-Label Products: Distributor can offer Morpho yield under their own brand with their own fee
> structure.**"

Concretely, the current wrapper family has these defects (all verified first-hand, see
`research.md`):

1. **A live tamperable target.** The deployed Base-Sepolia wrapper is immutably bound to
   `0x7f37…8420`, the test-tree `MockMorphoVault`, whose `simulateYield` / `simulateLoss` / `lendOut` /
   `setAvailableLiquidity` / `setMaxReturnsZero` hooks are plain `external` with **no access control**.
   *(Closed by Phase 0 of this feature.)*
2. **It cannot honestly price a Morpho Vault V2.** V2 declares `maxDeposit/maxMint/maxWithdraw/maxRedeem`
   as `pure returns (0)` by design. The wrapper's "VAULTS-V2 FALLBACK" therefore makes `maxWithdraw`
   **permanently optimistic** against any V2 child — an ERC-4626 MUST-violation on the exit path.
3. **It strips the user's best escape hatch.** V2's `forceDeallocate` is a permissionless in-kind
   redemption (≤2% penalty) that works *even when the vault is illiquid*. The wrapper exposes no path
   to it, so a wrapper depositor is strictly worse off than a direct depositor — cutting against N2.
4. **It cannot reach the venues that matter.** `SparkPointVaultFactory` stamps `usdc` as a shared
   immutable, so Robinhood's **USDG** vaults are unreachable by construction; and the constructor takes
   any `IERC4626` with **no `asset()` check and no interface probe**, so an allowlist entry pointing at
   Morpho Blue (a `MarketParams` singleton, *not* ERC-4626) would deploy a wrapper that bricks on first
   deposit.
5. **Checks-effects-interactions is inverted on both paths.** `_deposit` calls
   `_morphoVault.deposit(...)` before `_mint`; `_withdraw` calls `_morphoVault.withdraw(...)` before
   `super._withdraw` burns. The only trust root is the timelocked allowlist.
   *(Correction to an earlier claim: this **is** fixable — the `nonReentrant`/`ReentrancyGuard`
   prohibition in `contracts/test/refute/RefuteN2.t.sol:367` reads `SparkPointVault.sol`, the **Aave**
   vault, not the wrapper. `MorphoVaultNonCustody.t.sol` imposes no such ban. The case for retiring the
   wrapper rests on the audit bill and the V2 semantics above, **not** on unfixability.)*
6. **Never audited.** Feature 011's own mandatory pre-mainnet gate T035 (external audit + clean Slither)
   is still open, with no audit artifact in the repo.

### What is NOT wrong — and why we are not curating

Full curation (picking markets, setting caps, allocating capital) is **rejected**. It collides with
three ratified clauses at once, and a Fee Wrapper achieves the operator's actual goal — brand + fee —
without any of them:

- **IV.5** makes a vault ineligible if "*any SparkPoint-controlled address holds a role over the
  underlying*". Curating means we hold exactly those roles.
- **Principle VII** forbids "*cross-vault yield optimization, auto-rebalancing or automated
  fund-routing… and any meta-vault or router that moves user funds between curated Morpho vaults*".
- Curation is discretionary asset management in substance, and is economically thin at our TVL.

A Fee Wrapper **abdicates** its risk-management functions at deployment, so SparkPoint holds no
discretionary power over the child. That is why the amendment this feature needs is narrower than the
one curation would need.

### The deployment reality (verified on-chain 2026-07-30)

| Chain | ID | Aave v3 | Morpho Blue | Vault V2 factory | Depth | Asset |
|---|---|---|---|---|---|---|
| Base | 8453 | `0xA238Dd80…d1c5` | `0xBBBBBbbB…FFCb` | `0x45011255…5857` | 1,964 V2 vaults; Steakhouse Prime USDC **$571.8M** | USDC |
| Base Sepolia | 84532 | `0x8bAB6d1b…aE27` + stataUSDC | `0xBBBBBbbB…FFCb`, live markets | `0xE3a2CEbc…2ea0` (0 txs) | 50 MetaMorpho V1.1 vaults | **two** test USDCs |
| Robinhood Chain | **4663** | **none** | `0x9D53d5E3…1010` | `0x0FBad985…803c` | 21 V2 vaults; Steakhouse USDG **$215.8M** | **USDG** (6 dp) |
| Robinhood Chain | 46630 | none | **none** | **none** | none | — |

Two consequences the operator accepted:

- **"Morpho vaults on Robinhood testnet" cannot be built.** Chain 46630 has no Morpho whatsoever.
  Morpho's only documented testnets are Ethereum Sepolia and Base Sepolia, and its GraphQL API supports
  **no testnet at all**. Base Sepolia becomes the single rehearsal network; 46630 keeps its current
  honest posture (swap only, vault fail-closed on an empty allowlist).
- **Base Sepolia has no `MorphoVaultV1AdapterFactory` and no Bundler3**, so the canonical
  `FeeWrapperDeployer` path does **not** run there. Testnet rehearsal uses a plain Vault V2 +
  `MorphoMarketV1AdapterV2` into a live Blue market instead.

---

## User Scenarios

### User Story 1 — A testnet holder of the retired wrapper can still get out (Priority: P0) ✅ shipped in this PR

**Why:** N2 says only underlying liquidity may block an exit — never a SparkPoint decision. Closing
deposits is our call; closing withdrawals never is.

**Acceptance**

1. **Given** the demo wrapper is marked `retired`, **When** a user opens `/vault/deposit?vault=0xff0a…E9BB`
   and enters an amount, **Then** the CTA reads "Vault retired — withdrawals only" and is **disabled**.
2. **Given** the same wrapper, **When** the user opens `/vault/withdraw?vault=0xff0a…E9BB`, **Then** the
   withdraw screen renders exactly as before and is **not** gated on retirement, provenance or beta.
3. **Given** a user holding `spMORPHO` shares, **When** they open `/portfolio`, **Then** their position
   still renders as its own row.
4. **Given** a user deep-links `?vault=<retired address>`, **When** the page resolves, **Then** it
   resolves to the retired wrapper — **never** a silent fallback to the launch Aave vault.
5. **Given** the Trust Center, **When** it lists the wrapper, **Then** it says "retired · withdrawals
   only" and no longer claims "Morpho has no testnet".

### User Story 2 — A user can see every vault we support, on every chain, with an honest APY (Priority: P1)

**Acceptance**

1. Vault choices come from the **registry**, not a hard-coded `VaultKind` union or a single env var.
2. Every row shows: protocol, chain, asset, **our** fee, the **child's** fee, and the **net** APY.
3. On a chain/vault Morpho's API does not cover (all testnets), APY reads
   **"unavailable — testnet"** — never `0`, never a mainnet figure.
4. The Base-mainnet rows list **both** Steakhouse Prime USDC and Gauntlet USDC Prime (D2), each showing
   its **liquidity ratio**, so a user can trade scale against withdrawability.

### User Story 3 — A user can deposit into a SparkPoint Fee Wrapper (Priority: P1)

**Acceptance**

1. The Fee Wrapper is a Morpho Vault V2 deployed via `FeeWrapperDeployer.createFeeWrapper`, owned by
   the 2-of-3 Safe, with `abdicateNonCriticalGates: true`.
2. Its name/symbol **must not contain "morpho"** (Morpho naming restriction) — so `spMORPHO` is retired
   as a symbol too.
3. The **dead deposit** is executed as the very first transaction on the empty vault.
4. `forceDeallocate` is exposed as a first-class exit action.
5. The child's fees and ours are disclosed **separately and net**.

### User Story 4 — Robinhood Chain mainnet (4663) offers a USDG vault (Priority: P2)

**Acceptance**

1. Chain 4663 exists in the address book, the policy chain map and the SIWE list.
2. USDG is modelled as a first-class asset (6 dp asset / 18 dp shares).
3. The vault page states plainly that **Aave is not available on this chain**.
4. The liquidity ratio is visible **before** signature (Steakhouse USDG: $29.5M of $215.8M).
5. Chain 46630 continues to offer **no** vault, and says why.

---

## Functional Requirements

- **FR-001** A retired vault MUST fail-close deposits and MUST NOT affect withdraw, redeem or the
  portfolio row. *(Shipped.)*
- **FR-002** A retired vault MUST remain resolvable by address so no holder is silently redirected.
  *(Shipped.)*
- **FR-003** No SparkPoint surface may offer a deposit into a target whose underlying is a mock or is
  otherwise not a verified protocol deployment. *(Shipped.)*
- **FR-010** Vault choices MUST derive from the registry keyed on `(chain_id, protocol, vault_address)`.
- **FR-011** Every registry row MUST record `asset_decimals` **and** `share_decimals` separately —
  Morpho V2 shares are 18 dp over 6 dp assets; do not assume they match.
- **FR-012** APY MUST come from a background poller writing `vault_apy_snapshots`, never from the
  request path. Morpho's API is documented at 750 req/min and sustained abuse reportedly triggers a
  week-long cooldown.
- **FR-013** Where no APY source covers a chain, the UI MUST render "unavailable", never `0`.
- **FR-020** Allowlisting a child vault MUST pass an automated on-chain eligibility check:
  `factory.isVaultV2(child)`; `child.abdicated(selector)` true for `setReceiveSharesGate`,
  `setSendSharesGate`, `setReceiveAssetsGate`; `child.asset() == expectedAsset`; recorded
  `performanceFee()` / `managementFee()`; and a liquidity-ratio floor.
- **FR-021** A Fee Wrapper MUST be deployed with `abdicateNonCriticalGates: true` and owned by the
  2-of-3 Safe, never an EOA.
- **FR-022** Vault name/symbol MUST NOT contain "morpho".
- **FR-030** Robinhood testnet (46630) MUST continue to expose no vault and MUST state why.

---

## Non-Functional / Guardrails

- **N1–N5 unchanged.** A Fee Wrapper satisfies N1, N2 and N5 by Morpho's audited construction (gate
  setters abdicated, `addAdapter`/`removeAdapter` abdicated, `forceDeallocate` available).
- **The ≤20% / 0% fee cap becomes a policy + timelock guarantee, not a bytecode constant.** Morpho's
  ceilings are 50% / 5%. This is a **deliberate weakening of the enforcement mechanism** and MUST be
  stated in the amendment, not slipped through. Before committing, confirm whether V2's performance-fee
  accrual is high-water-mark and profit-only; if it is not, that is a **disclosure change**, not a
  wording change.
- **Fee Wrappers are not listed on app.morpho.org.** No third-party discovery, no MORPHO incentive
  accrual at the wrapper level. For a white-label product that is intended.

---

## Phasing

| Phase | Scope | Blocked on v3.0.0? |
|---|---|---|
| **0** | Retire the tamperable mock (deposits closed, withdrawals open) | **No** — shipped in this PR |
| **1** | Ratify constitution v3.0.0 | — |
| **2** | Registry (migration `0026`) + admin, **read-only/advisory** | **No** (010 FR-020: advisory ≠ interaction) |
| **3** | Real Morpho Vault V2 on Base Sepolia; delete the mock story | Yes |
| **4** | Honest net APY from the Morpho API | **No** (advisory) |
| **5** | Robinhood mainnet 4663 Fee Wrapper over Steakhouse USDG | Yes |
| **6** | Base mainnet Fee Wrappers over both D2 children | Yes + its own audit gate |

Splitting advisory work from the execute path means a ratification delay costs nothing.

---

## Out of Scope

- Full curation of a SparkPoint-owned Morpho vault (rejected — D1).
- Any Morpho surface on Robinhood testnet 46630 (impossible — no deployment).
- Deploying new `SparkPointMorphoVault` instances (superseded).
- The 011 pre-mainnet audit (T035) on the deprecated contracts — that spend should be stopped.
- Sui, the bridge, and Morpho Market V2 adapters (WIP upstream).

---

## Documentation-accuracy items found en route (not blockers)

- `_decimalsOffset()` is **never overridden** in `contracts/src/` — the OZ offset is therefore `0`, while
  both vaults' NatSpec describes "the default virtual-shares offset (donation/inflation safe)". The real
  defences are `totalAssets()` excluding idle USDC plus the `ZeroShares` guard. MetaMorpho uses offset
  12 for comparison. Reword the NatSpec.
- `contracts/src/adapters/AaveV3Adapter.sol` reverts `NotImplemented()` in `supply`/`withdraw`, and
  `contracts/src/governance/KillSwitch.sol` is self-documented "COMPILE-ONLY STUB SCOPE (W5-US1)" and is
  referenced by no vault — yet **both are deployed and published** in
  `contracts/deployments/84532/addresses.json`. Either annotate them as inert in the artifact or
  unpublish them; publishing addresses that imply capabilities they lack is a Principle III problem.
