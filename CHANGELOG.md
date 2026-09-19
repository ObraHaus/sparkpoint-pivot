# Changelog

All notable changes to **SparkPoint Pivot** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **History note.** The changelog starts here — earlier entries remain available in the git history.
> The repo changelog and the in-app changelog (`services/agent/content_seed/whats-new.json`) are
> reset together; a seed reset prunes the old in-app entries on the next agent boot/reingest.

## [Unreleased]

### Added (049 P9 — scoped wrapper deploy runner)

- **Agent queue + S2S work/report surface**: `wrapper_deployments` (migration 0039) records an admin's wrapper deploy request and the runner's result — loud failures included; `/curator/wrapper-jobs*` is machine-facing (S2S, no admin) and never authority. Registered before the `/admin/vaults/{vault}` catch-all.
- **`runners/src/deployer.ts`** (`SERVICE=deployer`): the scoped executor — local validation, on-chain allowlist check, simulate + `createVault`, success-receipt check, `VaultCreated` decode, CREATE2 salt from the request id, and lost-report recovery (existing code at the predicted address ⇒ report without a second tx). Holds the deploy-only key; contains no upgrade/allowlist/pause/fund selector (pinned by test). 14 new node:test units.


### Changed (governance — constitution v4.0.0: universal upgradeable wrapper family)

- **Contracts implemented (spec 049 P8):** `SparkPointUniversalVault` (universal implementation; child bound at initialization with no setter; child-claim `totalAssets`; HWM performance fee with fail-open accrual; caps + deposit-side pause; direct child unwind with a V2 `max*==0` liquidity fallback; `minSharesOut` overload; ERC-7201 storage), `SparkPointVaultFactoryV2` (UUPS fundless factory; curated allowlist; role-gated scoped deployer; on-chain child validation; CREATE2 BeaconProxy + per-wrapper CapRegistry; optional rolling deploy limit), plus OZ `UpgradeableBeacon` (owned by the timelock). 20 new Foundry tests (binding, gates, fee-above-HWM, loss/flat, pause-only, caps, slippage, donation, V2 fallback, beacon/factory upgrade authorization); full contracts suite **460 passed**. Not deployed — audit + operator-signed deploy remain.

- **Constitution v4.0.0 ratified** (MAJOR; operator grant 2026-09-18): NON-NEGOTIABLE **N5** is redefined from "non-upgradeable custody semantics" to **bounded, verifiable custody semantics** — a wrapper admitted under IV.5 may be upgraded **only** through a TimelockController-owned beacon (3-of-5 proposer, independent 2-of-3 canceller, ≥72h delay, no EOA), whose upgrade path is never an asset path and never gates withdrawals. Guardrails IV.5(a)/IV.6, Principle V (wrapper shapes + factory), the upgradeability constraint, and the named-contracts list are amended accordingly; single-child/no-meta-vault, allowlist admission, N1–N4, and the fee model are unchanged. Proposal: `.specify/memory/constitution-amendment-v4.0.0.md`.
- **Spec 049 (`specs/049-universal-vault-wrapper/`)** specifies the beacon fleet (`SparkPointUniversalVault` + TimelockController-owned beacon + deploy-only `SparkPointVaultFactoryV2` + `BeaconProxy` per curated vault) and the **scoped AI deployer** (deploy-only hot key held by a deterministic runner, never the keyless LLM agent). Residual risk recorded: an upgrade key can replace custody code — the timelock is a speed limit and exit window, not an impossibility proof.
- **Program roadmap** added at `docs/orchestration/vault-program-roadmap.html` (phases, status, decision log).


### Changed (swap polish — more tokens, one-tap chat swaps, less chrome)

- **The swap picker now recommends Robinhood Chain's canonical Stock Tokens** — SPY, NVDA, TSLA, GOOGL, META, COIN, AAPL, AMZN, MSFT, SPCX, QQQ, GLD, CRCL, RDDT. Addresses come from Robinhood's **official asset registry** (`api.robinhood.com/rhj/assets`, the same source as docs.robinhood.com/chain/contracts) and each was verified on-chain (18dp + a live Uniswap V3 pool vs WETH/USDG). Any other ERC-20 remains paste-importable.
- **“Route via” is gone from `/swap`.** Uniswap V3 is the one venue wired for execution and the quote engine already chooses the pool/path; the selector was chrome. The chosen route is still disclosed on the confirm screen.
- **Chat swap proposals arrive pre-filled.** “Swap 0.001 ETH to USDG” opens the inline card with the amount and both tokens already set — the user only confirms. To make that safe, `_swap_proposed_action` now carries the FROM token's real `decimals` (USDG is 6dp on 4663; the legacy field previously claimed 18) and the chain-local stable symbol (never labels USDG as USDC), and the card scales the base-unit amount with the resolved token's decimals (recommended pin or on-chain read).
- **SRK Pons buy link wired** (operator-confirmed launchpad URL) and the **Sparky Broker OpenSea link now points at the collection**.

### Changed (beta polish — honest labels, tidier pages, less in the way)

- **Fixed the label/value spacing on the broker and revenue pages.** `.payrow` was only styled on the premium page, so rows rendered as “Supply9 of 5,555 exist”; the style now lives in the global sheet.
- **“Partial data” chips are gone.** When something isn't available yet, the page says so plainly (the same register as `/vault` and `/strategies`) instead of carrying a badge.
- **Navigation cleanup:** Bridge is hidden for now, SRK moved inside Learn, and the Changelog moved into Settings — all still deep-linkable and searchable.
- **No testnet/faucet copy on the beta.** The testnet funding tip and the vault tips are gone; the SRK page no longer offers a faucet, states that SRK is a placeholder token, and links to its Pons launchpad.
- **The Sparky Broker page links to OpenSea** and says the collection is a placeholder for testing.

## [0.3.0] — 2026-09-18 — Beta launch (Robinhood Chain)

### Added

- **beta.sparkpoint.io is live on Robinhood Chain (4663).** Wallet connect + SIWE sign-in, Sparky chat, portfolio reads (native ETH + USDG), and user-signed **ETH ↔ USDG** swaps on the network's own Uniswap V3.
- **The 0.20% swap fee, disclosed before signing.** A non-custodial `FeeRouter` charges the fee on the input side and routes it to the immutable `RevenueSplitter` (90% broker holders / 10% treasury); the confirm screen shows the exact fee and where it goes.
- **Sparky Broker (test collection).** Clock in, promote and fuse brokers; Pons trading fees flow `splitter → engine pot → per-broker vault`, and a broker's owner withdraws what it earned.
- **Trust Center** lists every deployed 4663 contract with verifiable addresses — including the fee router and the swap quote source.

### Fixed

- **Sign-in no longer stalls** on a slow fail-open check (hard time budget + retry; the button says which step it is on).
- **Swap quotes work again** — 4663 shipped without a working quoter; a minimal read-only quote contract was deployed and wired.
- **The changelog reset clears the old in-app rows completely.** The seed prune now also removes entries created before slugs existed (seed-owned, `slug IS NULL`), so the in-app changelog shows exactly the committed seed — while an operator's Admin → Updates edit is still never touched.
