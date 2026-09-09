# Research — 024 Multi-Protocol Vaults

Every address below was verified on **2026-07-30** with `cast code` / `cast call` against a live RPC,
or read from `api.morpho.org/graphql`. Where a claim could not be verified first-hand it is marked
**UNVERIFIED**. Figures move — re-verify before any deploy.

## 1. Chain / deployment matrix

RPCs used: `base-sepolia.g.alchemy.com`, `mainnet.base.org`,
`rpc.mainnet.chain.robinhood.com` (returns chainId `4663`), `rpc.testnet.chain.robinhood.com`
(returns `46630`).

| Contract | Base 8453 | Base Sepolia 84532 | Robinhood 4663 | Robinhood 46630 |
|---|---|---|---|---|
| Morpho Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | same (15.6 KB) | `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` | **none** |
| AdaptiveCurveIrm | `0x46415998764C29aB2a25CbeA6254146D50D22687` | same | `0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1` | none |
| ChainlinkOracleV2 Factory | `0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d` | same | `0xB7c16F6F8cF531447Bf27Ca7220f981E79C9cdF2` | none |
| **VaultV2Factory** | `0x4501125508079A99ebBebCE205DeC9593C2b5857` | `0xE3a2CEbca662d99D0F279aF13a6bb8c9825D2ea0` | `0x0FBad98595b0186dA120E41f77C102beb49f803c` | none |
| MorphoVaultV1 AdapterFactory | `0xF42D9c36b34c9c2CF3Bc30eD2a52a90eEB604642` | **ABSENT** | `0x7a91222F3f7B927bB8fb624593Ca86e111C2F85e` | none |
| MorphoMarketV1 AdapterV2Factory | `0x9a1B378C43BA535cDB89934230F0D3890c51C0EB` | `0xa24674Cc2c603FBA8AE6b442E3dB05f3dDaAa3D5` | `0x79370Ed003CE325C088E530d5e8655c99c2993e1` | none |
| MorphoRegistry | `0x5C2531Cbd2cf112Cf687da3Cd536708aDd7DB10a` | `0xCED92dd29B6E99120DD41CB79321126Abd5852b2` | `0xe785a2eFD384BA7B95BaEd3851BC76aeD67C676f` | none |
| MetaMorpho Factory V1.1 | `0xFf62A7c278C62eD665133147129245053Bbf5918` | `0x2c3FE6D71F8d54B063411Abb446B49f13725F784` | **none (V2-only chain)** | none |
| Bundler3 | `0x6BFd8137e702540E7A42B74178A4a49Ba43920C4` | **ABSENT** | `0x6478e9393d4C5bB4d53ee881d1DE78786A0344a6` | none |
| Aave v3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` | **none** | none |

The three live `VaultV2Factory` deployments are byte-identical in size (23,124 B) and all carry the
`createVaultV2(address,address,bytes32)` selector `0xa7a28469`.

> **A trap worth recording.** A first pass misread the docs and put the Base-Sepolia VaultV2Factory at
> `0x2DC205F2…bd3d`. That address *is* live on 84532 — but it is the **Chainlink Oracle V2 factory**; it
> carries none of the factory selectors. Always confirm a docs address with `cast code` + a selector
> probe before writing it into an address book.

## 2. Candidate Fee Wrapper children — all eligibility checks pass

| Child | Chain | TVL | Liquid | Net APY | perf/mgmt fee | gate setters abdicated | `isVaultV2` |
|---|---|---|---|---|---|---|---|
| Steakhouse Prime USDC `0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9` | 8453 | $571.8M | $147.9M (25.9%) | 4.40% | 0 / 0 | all 3 `true` | `true` |
| Gauntlet USDC Prime `0x050cE30b927Da55177A4914EC73480238BAD56f0` | 8453 | $89.9M | $77.8M (**86.6%**) | 4.40% | 0 / 0 | all 3 `true` | `true` |
| Steakhouse USDG `0xBeEff033F34C046626B8D0A041844C5d1A5409dd` | 4663 | $215.8M | $29.5M (13.7%) | 2.77% | 0 / 0 | all 3 `true` | `true` |

Checked via `child.abdicated(bytes4)` for `setReceiveSharesGate` `0x2cb19f98`,
`setSendSharesGate` `0xc21ad028`, `setReceiveAssetsGate` `0x04dbf0ce`; and
`VaultV2Factory.isVaultV2(child)`. **`abdicated` is a public mapping — make this an automated
pre-allowlist CI check (FR-020).**

All three charge **zero** native fees, so a SparkPoint fee would be the only fee in the chain. Not
universal: *Steakhouse High Yield USDC Edition* (`0xbeeff249…8845`, $254.8M) charges 25%.

Base mainnet has **1,964** Vault V2s (`pageInfo.countTotal`). An early query capped at 40 items sorted
locally and produced a badly wrong "largest V2 = $2.1M" — always pass `orderBy: TotalAssetsUsd`.

Robinhood 4663 has 21 V2 vaults, **all USDG**, and creation is permissionless: alongside Steakhouse's
$215.8M sits `hoodbet.fun` at **−3.4% net APY with a 50% performance fee**. An allowlist is not optional.

## 3. Morpho API

`POST https://api.morpho.org/graphql`. `{ chains { id } }` returns
`[1, 10, 130, 137, 143, 480, 988, 999, 4217, 4663, 5042, 8453, 42161, 747474]` — **all mainnets**.
`chainId: 84532` errors `unsupported chainId "84532"`. **4663 IS supported.**

- `vaults(...)` = V1/MetaMorpho; `vaultV2s(...)` / `vaultV2ByAddress(address, chainId)` = V2.
- `avgNetApy` is pre-computed **net of the whole fee chain** (child fees + wrapper fees + rewards) —
  query it with **our wrapper's** address, not the child's. This satisfies the constitution's
  "stacked fee MUST be disclosed net" requirement directly.
- **UNVERIFIED (from research, treat as operational guidance):** ~750 req/min, with sustained abuse
  (~20k/hour) reportedly triggering a week-long cooldown. Poll in the background; never on the request
  path.

## 4. Vault V2 mechanics (read from `morpho-org/vault-v2` source)

- `VaultV2Factory.createVaultV2(address owner, address asset, bytes32 salt) → address`. The constructor
  takes **only** `(owner, asset)`; **name/symbol are set post-deploy** via `setName`/`setSymbol`.
- `decimals = assetDecimals + decimalOffset` (padded to 18); `virtualShares = 10**decimalOffset` —
  inflation protection is built in.
- `maxDeposit/maxMint/maxWithdraw/maxRedeem` are **`pure returns (0)`** by design ("*Gross
  underestimation because being revert-free cannot be guaranteed when calling the gate*") and are **not**
  enforced inside `deposit`/`withdraw`. Any integrator reading `max*` on a V2 gets 0.
- `forceDeallocate` — permissionless in-kind redemption, penalty ≤2% (`MAX_FORCE_DEALLOCATE_PENALTY`).
- Fee ceilings **50% performance / 5% management**. Timelocks 0–3 weeks. `maxRate` must be set for
  suppliers to earn.
- Roles: **Owner** — `setOwner/setCurator/setIsSentinel/setName/setSymbol` only, no power over assets.
  **Curator** — everything else, all timelocked except `decreaseAbsoluteCap`/`decreaseRelativeCap`.
  **Allocator** — `allocate`, `setLiquidityAdapterAndData`, `setMaxRate`. **Sentinel** — `revoke`,
  `deallocate`, decrease caps, instantly.
- `abdicate(bytes4)` permanently renounces a selector; `abdicated(bytes4)` is a public mapping.
- Only **two** adapters ship: `MorphoMarketV1AdapterV2` (Blue markets) and `MorphoVaultV1Adapter` (into a
  MetaMorpho vault). A Morpho Market V2 adapter is WIP. **There is no Aave adapter and no generic
  ERC-4626 adapter** — so a Morpho Vault V2 can never hold an Aave position. Aave must stay in
  `SparkPointVault`.
- Setting the official `MorphoRegistry` then abdicating `setAdapterRegistry` is what makes a vault an
  "official" Morpho Vault V2 (app.morpho.org listing, support, incentives). A **Fee Wrapper is not
  listed** — intended for white-label.

## 5. Fee Wrapper deployment

`FeeWrapperDeployer.createFeeWrapper(morphoVaultV2Factory, morphoVaultV1AdapterFactory, FeeWrapperConfig)`
from `morpho-org/morpho-snippets` (`src/vault-v2/FeeWrapperDeployer.sol`), driven by its sanctioned
`script/DeployFeeWrapper.s.sol`.

```
FeeWrapperConfig {
  address owner;                    // MUST be the multisig
  bytes32 salt;                     // effective salt = keccak256(msg.sender, owner, childVault, salt)
  address childVault;               // MUST be a Vault V2 — never a V1
  string  name; string symbol;      // MUST NOT contain "morpho"
  uint256 performanceFee;           // WAD, e.g. 0.1e18 = 10%
  uint256 managementFee;            // WAD/second — 0 for us
  address feeRecipient;
  bool    abdicateNonCriticalGates; // MUST be true
}
```

- The salt binds the address to the deploying EOA (anti-squatting), so the script must pin the
  broadcaster.
- **No `FeeWrapperDeployer` address appears in Morpho's addresses page** — we deploy our own,
  release-pinned copy, with an ABI-hash check in CI (`vault-v2` is under active change).
- It requires the **`MorphoVaultV1AdapterFactory`**, which is **absent on Base Sepolia** ⇒ the canonical
  Fee Wrapper path does **not** run on 84532.

### Dead deposit — CONFLICT SETTLED (measured on a fork, 2026-07-30)

**Resolved empirically against the real deployed factory on an anvil fork of Base Sepolia. The
dead-deposit page is right; the vault-creation page's Phase-8 comment is wrong.** Measured:

```
vault.virtualShares()             = 1e12       (decimalOffset 12 for a 6-dp asset; decimals()=18)
vault.previewMint(1e18 shares)    = 1000000    = EXACTLY 1.000000 USDC
after mint(1e18, 0xdead)          : totalAssets 999999, 0xdead holds 1e18 shares
deployer USDC 8.685350 -> 7.685350            (spent exactly 1.000000)
```

The argument is **SHARES**. Reading the vault-creation page's "1e12 for ≤9 decimals" as *assets*
would mean 1,000,000 USDC — unaffordable and absurd; reading it as *shares* would cost 1 base unit
(0.000001 USDC), far too small to defend against the inflation attack that is the dead deposit's
whole purpose. Only `mint(1e18, 0xdead)` ≈ 1 USDC is coherent with V2's arithmetic AND with the
dead-deposit page's own table.

The deploy script now **guards this**: it reads `previewMint` live and refuses to proceed if the cost
is not exactly 1,000,000 base units, because the step cannot be undone.

### Other Phase-3 facts verified on the same fork

- **Cap id pre-images.** `increaseAbsoluteCap(bytes idData, …)` takes the PRE-IMAGE and the vault
  hashes it. `keccak256(abi.encode("this", adapter))` equals the adapter's own on-chain
  `adapterId()` exactly. The adapter exposes **three** ids — `adapterId`,
  `keccak(abi.encode("collateralToken", collateral))`, and
  `keccak(abi.encode("this/marketParams", adapter, marketParams))` — and all three need caps.
- **`increaseTimelock` really must be last.** After raising its own timelock, a further
  `submit` + immediate `increaseTimelock` **reverted** (delay not elapsed). Any selector left
  un-timelocked past that point stays that way for 3 days.
- **Timelocks must precede the role handover** — an ordering the docs get backwards for our flow.
  `submit` is CURATOR-gated, so once `setCurator(Safe)` runs the deployer can no longer submit and
  every remaining `increaseTimelock` reverts `Unauthorized` (`0x82b42900`). Found by running the
  script with roles first. Morpho's docs list roles (Phase 6) before timelocks (Phase 9), which
  only works if the *new* curator performs them.
- **N2 exit path works.** Round trip on the fork: deposit 2 USDC → `redeem` ALL shares → full
  principal returned, shares 0. `forceDeallocate(address,bytes,uint256,address)` = `0xe4d38cd8` is
  present; `forceDeallocatePenalty(adapter)` starts at 0.
- **`maxDeposit/maxMint/maxWithdraw/maxRedeem` all returned 0** on the live V2, as documented, and
  are not enforced inside deposit/withdraw. Confirms: never derive a UI limit from them on a V2.
- **The address is deterministic.** `VaultV2Factory.vaultV2(owner, asset, salt)` is a view that
  returns the same address the create produced, so the real deployment address is pre-computable
  from `(deployer, Circle USDC, keccak("sparkpoint-usdc-v2-basesepolia-001"))` — no log parsing.
- **The resulting vault passes `vault-eligibility-check.sh` (FR-020)** — the gate and the deploy
  script agree, which is a useful cross-check that neither is wrong in isolation.

### Dead deposit — the original conflict, for the record

`docs/curate/tutorials-v2/dead-deposit` gives `targetShares = max(1e9, 10^(6 + max(0, 18 - decimals)))`,
a table (USDC, 6 dp → mint **1e18 shares**, spend **1 USDC**, ≈$1), and an approval table (6 dp →
`1000000`). These agree with each other **and** with V2's arithmetic (`virtualShares = 10^12` for a 6 dp
asset, so `1e18 shares / 1e12 = 1e6 base units = 1 USDC`).

The **vault-creation** page's Phase 8 comment instead reads "1e9 for ≥10 decimals, **1e12** for ≤9
decimals" against a function taking *assets* — which for USDC would be 1,000,000 USDC. That comment is
believed loose or share-denominated. **This is a one-shot irreversible step: reconcile against the
pinned release and simulate on a fork before any mainnet run.**

Also required: `0xdead` must hold **1e9 supplyShares** in every market with a non-zero cap, and 1e9
shares in every V1 vault with a non-zero cap.

## 6. Base Sepolia specifics

- Morpho Blue is genuinely in use: Blockscout logs show `CreateMarket` ×2, `Supply`, `Borrow`,
  `SupplyCollateral`, `Repay`, `AccrueInterest`.
- Live markets, e.g. `0x01351cf859346bbae655f1c9da71ba0e9ad201dd79a276c28f34e574386b0bfb`:
  loan = **Circle test USDC** `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 dp), collateral `dTBTC`
  `0xd49c27a5…32fC` (8 dp), irm = AdaptiveCurveIrm, lltv 86%.
- A working USDC MetaMorpho V1.1 vault exists: **MetaMorpho PARC DCC**
  `0xbeefc2216c0450841d70390e58042775cfa43dbe` — `asset()` = Circle test USDC, `totalAssets` ≈ 52 USDC,
  `maxDeposit` ≈ 34 USDC, 6 markets in the supply queue.
- **The two-USDC problem.** Aave's Base-Sepolia market and our launch vault use
  `0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f`; Morpho's markets use Circle's
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Both report `symbol() == "USDC"`, 6 dp, and are **not**
  interchangeable. The registry must carry `asset_address` per row and the UI must disambiguate.
- Aave stataTokens do exist here: `StataTokenFactory 0x4Afb5ADe7Bd7a670B61f303ab0C740eE8350918f`,
  `stataUSDC 0xf430cb6E2b85f99222fBFA6dFEa18Ff60FA6B32a` (`waBasSepUSDC`, `asset()` = the Aave test USDC,
  ~41.8k deposited) — a real ERC-4626 over Aave, useful if we ever want one interface for both legs.
- The Base-Sepolia `VaultV2Factory` has **0 transactions** — we would be its first user, with no
  reference deployment to compare against.

## 7. Repo facts

- Next free spec number was **023**, but a parallel agent claimed it on 2026-07-30 for
  `023-hermes-mainnet-hardening` (uncommitted in a sibling worktree, scoped to `services/agent/`).
  This feature therefore takes **024**. Highest applied migration is `0025_session_keys.sql` ⇒ the
  registry migration is **`0026`**.
- There is **no `vaults` table** in any migration; `0002_vault.sql` references a `vaults.address` that was
  never created. The backend resolves one vault from `SPARKPOINT_VAULT_ADDRESS`.
- `VaultKind` is a hard-coded union `"aave_launch" | "morpho_wrapper"`; `84532` is hard-coded across
  ~30 web files; `wagmi.ts` and `network.tsx` keep two independent chain lists that can drift.
- `RefuteN2.t.sol:367` reads **`SparkPointVault.sol`** (the Aave vault) when asserting the absence of
  `nonReentrant`/`ReentrancyGuard`. `MorphoVaultNonCustody.t.sol` asserts only `whenDepositsAllowed`
  present / `whenNotPaused` absent / immutable target / no egress selector. **A reentrancy guard on the
  Morpho wrapper is not test-forbidden** — an earlier claim to the contrary is false.
- `_decimalsOffset()` is not overridden anywhere in `contracts/src/` ⇒ OZ offset 0.
- `AaveV3Adapter` reverts `NotImplemented()`; `KillSwitch` is a self-documented "COMPILE-ONLY STUB" that
  no vault references. Both are deployed and published in `deployments/84532/addresses.json`.
