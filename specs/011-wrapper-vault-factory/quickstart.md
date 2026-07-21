# Quickstart: Wrapper Vault Factory

How to build and verify the feature locally + on Base Sepolia (84532, the alpha chain).

> **⛔ BLOCKED — do not run any of this until the Phase-0 constitution amendment is ratified.** This
> feature routes pooled user funds into Morpho (a non-whitelisted protocol under Guardrail IV.5) and adds
> vaults beyond the "SINGLE conservative Aave Yield Vault" (Principles V + VII). Per Governance, that is a
> change to custody semantics and requires **super-majority re-ratification** that "MUST NOT be made
> implicitly through implementation." See [`plan.md`](./plan.md) Constitution Check and [`tasks.md`](./tasks.md)
> T001. Everything below is the verification plan for AFTER ratification.

## Prerequisites

- Node 20 (`.nvmrc`), pnpm 9 (NOT 11 — the pnpm-version trap; use pnpm 9 for any dep change).
- Foundry (`forge`/`cast`) — the repo toolchain in `contracts/foundry.toml`.
- A wallet with Base Sepolia (84532) test ETH + test USDC (use the in-app Faucets panel).
- The OWNER key = the OZ `TimelockController` (`0x0A21…d720`) governance spine, NOT an EOA, for `createVault`
  and `allowlistMorphoVault`. On testnet a test timelock/EOA may stand in; on mainnet it MUST be the timelock.
- `pnpm install --frozen-lockfile` at the repo root.

## ⚠️ Step 0 — VERIFY the real Base Sepolia Morpho factory address on-chain FIRST

The widely-quoted MetaMorpho/Vaults-V2 factory `0x4501…5857` is the **MAINNET** address. Do NOT assume it
exists on 84532. Before anything, confirm the real Base Sepolia factory has code:

```bash
cast code 0x<candidate-morpho-vault-v2-factory> --rpc-url $BASE_SEPOLIA_RPC   # must be non-empty (0x…)
# Cross-check against sepolia.basescan.org. Morpho Blue on 84532:
#   0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb  (verify code too)
```

If the factory address returns `0x` (no code), you are on the wrong address — find the real one via
sepolia.basescan.org before proceeding. Morpho subgraphs are deprecated; the Morpho API/app are
**mainnet-only**, so none of the API tooling helps on testnet.

## Step 1 — Create + seed a test Morpho vault + market + oracle (testnet only)

There are no ready curated vaults/yield/API on Base Sepolia — you must create your own:

```bash
# 1. Deploy a Chainlink-Oracle-V2 (via the 84532 factory) for USDC/collateral.
# 2. Create a Morpho Blue market (loanToken = test USDC, your oracle + Adaptive-Curve IRM).
# 3. Create a MetaMorpho V1.1 vault (via the real, verified 84532 MetaMorpho factory) over that market.
# 4. Seed liquidity + set a small NATIVE curator fee so the double-fee disclosure has something to show.
forge script contracts/script/SeedTestMorpho.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
# Record the resulting curated IERC4626 (MetaMorpho) address -> $MORPHO_VAULT
```

Because the Morpho API is mainnet-only, APY on testnet is **on-chain-derived or mocked** from this market's
IRM/borrow state — never fabricated. On Base mainnet (8453) use a real curated vault instead of steps 1–4.

## Step 2 — Deploy the factory + allowlist the curated vault

```bash
forge script contracts/script/DeployMorphoWrapperFactory.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC --broadcast
# owner = TimelockController; then, as owner:
cast send $FACTORY "allowlistMorphoVault(address,bool)" $MORPHO_VAULT true \
  --rpc-url $BASE_SEPOLIA_RPC --account timelock
cast call $FACTORY "isAllowlisted(address)(bool)" $MORPHO_VAULT --rpc-url $BASE_SEPOLIA_RPC   # -> true
```

Confirm the factory holds no funds and exposes no fund-egress selector:

```bash
cast balance $FACTORY --rpc-url $BASE_SEPOLIA_RPC     # 0
forge script contracts/script/AssertNonCustody.s.sol --rpc-url $BASE_SEPOLIA_RPC   # factory + wrapper pass
```

## Step 3 — Deploy a branded wrapper via the factory

```bash
cast call $FACTORY "predictVaultAddress(address,string)(address)" $MORPHO_VAULT "SparkPoint · Test USDC" \
  --rpc-url $BASE_SEPOLIA_RPC    # note the predicted address
cast send $FACTORY \
  "createVault(address,uint16,(uint256,uint256),string)" \
  $MORPHO_VAULT 1000 "(0,0)" "SparkPoint · Test USDC" \
  --rpc-url $BASE_SEPOLIA_RPC --account timelock
# -> wrapper deploys at the predicted CREATE2 address; VaultCreated emitted; row written to sparkpoint_wrappers (011-owned).
```

Verify the instance's immutables + non-custody surface:

```bash
cast call $WRAPPER "morphoVault()(address)"        --rpc-url $BASE_SEPOLIA_RPC   # == $MORPHO_VAULT
cast call $WRAPPER "asset()(address)"              --rpc-url $BASE_SEPOLIA_RPC   # == test USDC
cast call $WRAPPER "performanceFeeBps()(uint16)"   --rpc-url $BASE_SEPOLIA_RPC   # 1000
cast call $WRAPPER "MAX_PERFORMANCE_FEE_BPS()(uint16)" --rpc-url $BASE_SEPOLIA_RPC # 2000
# No sweep/migrate/rescue selector resolves on the wrapper (N1).
```

## Verify by user story

**US1 — governance gate (human, not code).** Confirm the operator has ratified the amendment (constitution
bumped, amendment record present, super-majority approval logged). Until then, STOP — no factory, template,
or admin code exists to test.

**US2 — template + tests.** Run the Foundry suite that re-proves N1/N2/N5 under non-rebasing shares +
partial Morpho liquidity:

```bash
cd contracts
forge test --match-path 'test/**/MorphoVault*'                 # unit + fuzz
forge test --match-path 'test/invariant/MorphoVaultNonCustody.t.sol'   # N1 no-egress, N2 withdraw-always
forge test --match-path 'test/fork/MorphoVaultFork.t.sol' --fork-url $BASE_RPC   # fork vs a real curated vault
```

**US3 — factory + allowlist.** From a non-owner, `createVault` reverts; a non-allowlisted `morphoVault`
reverts; `feeBps 2001` reverts; the deploy lands at `predictVaultAddress`; de-allowlisting the vault leaves
`$WRAPPER` fully withdrawable (N2). See Steps 2–3.

**US4 — admin manage half.** Open `/admin/vaults`. The 010 READ half shows live state; the 011 MANAGE half
lets you: (a) create a vault (validates the curated allowlist, returns `createVault` calldata you sign —
the server never signs); (b) queue a guardian action (pause / setFee / setFeeRecipient / adjust caps) as
prepared OZ-Timelock `schedule`+`execute` calldata; (c) confirm the action menu contains **no** move-funds
verb — the "no move-funds action exists" invariant is visible. Sign a `pauseDeposits` via the timelock and
confirm deposits pause while a withdraw still succeeds.

**US5 — app deposit/withdraw.** In the app, select the branded wrapper (it appears in the 010
registry/reader automatically once its row + factory provenance verify). Deposit test USDC via the SAME
confirm gate as the launch vault; confirm the disclosure states the yield is **Morpho, not Aave**, and that
the SparkPoint fee **stacks** on Morpho's native curator fee (honest double-fee). Withdraw — confirm it
succeeds up to live Morpho liquidity even with deposits paused (N2), and reverts cleanly (no silent
short-fill) above the clamped `maxWithdraw`.

## Tests

```bash
# Contracts (the non-custody re-proof is the load-bearing gate):
cd contracts && forge test && forge coverage --match-path 'src/vault/SparkPointMorphoVault.sol'
forge test --match-path 'test/fork/MorphoVaultFork.t.sol' --fork-url $BASE_RPC

# Web (admin manage + app deposit/withdraw view-models):
pnpm --filter @sparkpoint/web test
pnpm --filter @sparkpoint/web exec playwright test e2e/pw/admin-vaults-manage.spec.ts   # long hydration budget

# Agent registry/reader (010 reads the new wrapper rows):
cd services/agent && uv run pytest tests/chain tests/api -q

# Green gate before any PR:
pnpm -w typecheck && pnpm -w lint && pnpm -w build
```

## Honest-state matrix (manual smoke)

| Case | Expected |
|---|---|
| `createVault` from non-owner | reverts (admin-gated) |
| `createVault`, morphoVault not allowlisted | reverts (whitelist by construction) |
| `createVault`, feeBps > 2000 | reverts (20% cap) |
| Deploy | lands at `predictVaultAddress`; `isSparkPointVault == true` |
| Wrapped Morpho share price rises | `totalAssets()` rises; fee accrues only above HWM |
| Wrapped Morpho share price falls (loss) | `totalAssets()` falls honestly; NO fee; principal not taxed |
| Deposits paused, user withdraws | withdraw succeeds (N2) |
| Partial Morpho liquidity | withdraw up to clamped `maxWithdraw`; clean revert above (no silent short-fill) |
| Wrapped vault is Vaults V2 (`max*` == 0) | availability derived from market liquidity, N2 not spuriously blocked |
| Guardian de-allowlists the wrapped vault | existing instance still fully withdrawable |
| Admin manage menu | contains NO move-funds action (N1 visible) |
| App deposit disclosure | states Morpho-not-Aave + stacked double-fee (III) |
| Factory balance | always 0; no fund-egress selector |

## Living docs to update before "done"

- `CHANGELOG.md` — dev bullet under `## [Unreleased]` per phase (template, factory, admin-manage, app deposit).
- `services/agent/content_seed/whats-new.json` — a client-facing entry per user-visible phase (US4 admin,
  US5 app deposit/withdraw), stable `slug`.
- `DEVELOPMENT.md` — the factory + curated-vault address-book fields, the Morpho GraphQL data feed
  (mainnet-only), and any new env var (e.g. `MORPHO_GRAPHQL_URL`).
- `.specify/memory/constitution.md` — the ratified amendment record (US1) + version bump.
- `MIGRATIONS.md` — the 011 migration `0015_vault_factory.sql` (curated allowlist + `sparkpoint_wrappers`; apply with
  `PGCLIENTENCODING=UTF8`).
- The in-app `/admin/vaults` + `/changelog` copy — the branded-wrapper double-fee disclosure.
