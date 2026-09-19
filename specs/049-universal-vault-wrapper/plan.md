# Implementation Plan — 049 Universal upgradeable vault wrapper

**Spec**: `specs/049-universal-vault-wrapper/spec.md` · **Ratification**: constitution v4.0.0 (`constitution-amendment-v4.0.0.md`) · **Research**: `sparkpoint-ai-morpho-vaults-plan.html` §4–§8.

## Architecture

```
TimelockController (3-of-5 proposer · independent 2-of-3 canceller · ≥72h)
        │ owns
UpgradeableBeacon ──points──► SparkPointUniversalVault (implementation)
        │                          ▲ delegatecall (all state in proxy)
        │
SparkPointVaultFactoryV2 ──CREATE2──► BeaconProxy + CapRegistry  (one per curated vault)
        ▲ deploy role
Curator deploy runner (keeper-style, holds scoped key 0xB555…D875, gas only)
        ▲ proposal/report
Curator (keyless) / Admin panel / S3 store
```

### Contracts (`contracts/src/vault/`, `contracts/src/factory/`)

1. **`SparkPointUniversalVault`** — the implementation (OZ upgradeable ERC-4626):
   - `initialize(asset, child, guardian, factory, capRegistry, feeRecipient, feeBps, name, symbol, label)`; `_disableInitializers()` in the constructor.
   - Child bound in storage at init, **no setter**; `asset()` must equal `child.asset()` (also validated by the factory).
   - `totalAssets()` = `child.convertToAssets(child.balanceOf(this))` (non-rebasing claim; donations do not move pps). V2 `max*==0` fallback for liquidity (feature-011 parity).
   - Fee: lazy `accrueFee()` (share-price HWM, dilution, fail-open try/catch), `_settleHighWaterMark()` on deposit, split cap ≤2000 bps.
   - Caps: `maxDeposit/maxMint` via CapRegistry, `paused` (deposits only).
   - Slippage: standard ERC-4626 entry points + `deposit(assets, receiver, minSharesOut)` overload (ERC-5143-style; standard interface untouched).
   - Inflation defense: `_decimalsOffset()` = 3 (virtual shares) + refuse zero-share deposits.
   - Storage: ERC-7201 namespaced struct (OZ v5 upgradeable pattern).
2. **`SparkPointVaultBeacon`** — thin wrapper over OZ `UpgradeableBeacon` with no extra powers (owner = Timelock; `upgradeTo` timelocked off-chain; optional `renounceOwnership` via OZ).
3. **`SparkPointVaultFactoryV2`** — deploy-only:
   - `createVault(child, feeBps, caps, label, salt)` role-gated to `deployers[msg.sender]` (owner = timelock can manage roles);
   - requires `isAllowlisted(child)`, `feeBps ≤ 2000`, sane caps/labels; runs the FR-049-007 validation;
   - CREATE2-deploys a per-wrapper `CapRegistry` (owner = timelock) + a `BeaconProxy` (OZ) and initializes atomically;
   - emits `VaultCreated(child, proxy, capRegistry, deployer, feeBps, label)`; no post-deploy authority over the proxy.
4. **`CapRegistry`** — unchanged from feature 011 (reuse; owner = timelock).

### Deployer runner (P9)

- New `runners/src/deployer.ts` (same pattern as keeper/sweeper/curator): reads a deploy request record (child, feeBps, caps, label) from the agent admin API, pre-checks allowlist/fee/caps, sends `createVault`, waits for the receipt, reports the tx + predicted address back; heartbeats + fail-loud on an unreported deploy.
- Holds only `WRAPPER_DEPLOYER_PRIVATE_KEY` (0xB555…) and gas. Never receives upgrade/allowlist/pause authority.
- LLM agent stays keyless; the admin panel "deploy wrapper" button only *requests* (same shape as the curator Run-now marker).

### Constants

- Fee cap `MAX_PERFORMANCE_FEE_BPS = 2000` (bytecode), default `1000`.
- Beacon authority: 3-of-5 / 2-of-3 / `MIN_DELAY = 259200` (72h).
- Decimals offset `3`; caps mirror feature-011 (per-user, total, vault).

## Sequencing

1. **P7 (done with this spec)** — constitution v4.0.0 + amendment + spec/plan/tasks.
2. **P8** — contracts + Foundry tests (unit/fuzz/upgrade) + CI gates.
3. **P9** — deployer runner + agent request/report endpoints + monitoring.
4. **P10** — external review + fork rehearsal + operator-signed deploy of beacon/implementation/factory on 4663 + allowlist seed (Gate 0 applies to wrapping, not to deploying the fleet).
5. **P11** — store `wrapped` flag + rail wiring + Trust Center copy + changelogs; spec 048 M1 tasks closed with a pointer to 049.

## Risks

- **Upgrade key = ultimate custody power.** Mitigations are process + on-chain (timelock, canceller, exit window). Residual risk is disclosed, not removable.
- **Beacon blast radius** — one buggy upgrade hits every wrapper. Mitigated by CI invariant fuzzing + fork rehearsal + external review; accepted by the operator.
- **Proxy/initializer class bugs** (Parity/Audius/Nomad). Mitigated by OZ upgradeable ERC-4626 + ERC-7201 + `_disableInitializers()` + atomic init + upgradeability CI checks.
- **Child variance** (reverting previews, queued exits, FoT assets, blacklists). Mitigated by allowlist + on-chain validation + v1 policy (sync, USDC-first only, no 7540/7575).
- **Deploy-key compromise** — bounded to junk deploys over allowlisted children (phishing/spam, never a fund path); rate-limit + alert + rotatable.
- **Gate 0** — no child vault exists on 4663 yet; fleet can deploy and be tested against mocks/forks, but wrapping waits for a live child (or an operator/scope decision).
