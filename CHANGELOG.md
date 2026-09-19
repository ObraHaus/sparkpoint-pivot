# Changelog

All notable changes to **SparkPoint Pivot** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **History note.** The changelog starts here — earlier entries remain available in the git history.
> The repo changelog and the in-app changelog (`services/agent/content_seed/whats-new.json`) are
> reset together; a seed reset prunes the old in-app entries on the next agent boot/reingest.

## [Unreleased]

### Removed (web)

- **The “SparkPoint’s own vault” card is gone from `/vault`.** The vault program is wrap-only for now — curate an existing vault, wrap it via our factory, onboard it — so the page stays focused on the curated board and no longer implies a SparkPoint-originated vault is coming to this network.

### Added (P12 — on-chain vault discovery)

- **The curator now discovers vaults from the chain itself, not just an API.** A new crawler enumerates every `VaultV2Factory.CreateVaultV2` log on 4663 (block 0 → head), reads each vault's facts on-chain (asset, `totalAssets`, fees, curator/owner, age, gate abdication) and re-checks the FR-020 gate abdications for every candidate. API candidates missing from those logs get a DANGER warning and fail screening; a crawl failure degrades to API-only and says so (fail-open). A second, optional archive RPC derives a share-price APY for vaults the API has no figure for.
- **Adapter pointed at the right source: `api.morpho.org/graphql` + the `vaultV2s` query.** The previous `blue-api…vaults` call returns an empty set on 4663 because the chain is V2-only — that empty set, not an empty chain, was the "0 vaults" blocker. First live run: **58 vaults enumerated, 58 verified, pick = Steakhouse USDG (~$482.4M, 3.58% net APY, score 57)**, alternate Purinta USDG.

### Fixed (beta runners)

- **The `deployer` service was rejected by the container healthcheck.** `healthcheck.ts` still only allowed `keeper` / `sweeper` / `curator`, so the new `sparkpoint-deployer-beta` container exited 1 on every health probe and Coolify stopped it right after deploy. The deployer now has its own freshness window driven by `DEPLOYER_POLL_SEC` (default 120s), plus a regression test covering the service list.

### Added (049 — wrapper fleet deployed on Robinhood Chain 4663)

- **The universal wrapper fleet is live on 4663** (operator-signed, 2026-09-19): TimelockController `0x62b8b01c…b0B5` (72h delay, PROPOSER = a 3-of-5 Safe `0xA63Ad1a2…E7Bf`, CANCELLER = an independent 2-of-3 Safe `0xe208F33a…8150`, deployer renounced admin), `UpgradeableBeacon` `0xC4D6D11f…ab0c`, `SparkPointUniversalVault` implementation `0xCe1cd084…3D542`, and `SparkPointVaultFactoryV2` behind a Transparent proxy `0x040A7BFD…466dE` (owner/guardian = the timelock). All roles, owners and the 72h delay verified by on-chain reads; recorded in `contracts/deployments/4663/addresses.json → wrapper`. The AI deployer (`0xB555…D875`) was enabled through the timelock: `schedule` executed 2026-09-19 (Safe-A tx `0x9e6d3d05…c0df`, op `0x3581b36c…85e0`), permissionless `execute` due 2026-09-22 07:43:22 UTC; nothing is wrapped yet — Gate 0 (a live child vault on 4663) still stands.


### Added (049 P9 — scoped wrapper deploy runner)

- **Agent queue + S2S work/report surface**: `wrapper_deployments` (migration 0039) records an admin's wrapper deploy request and the runner's result — loud failures included; `/curator/wrapper-jobs*` is machine-facing (S2S, no admin) and never authority. Registered before the `/admin/vaults/{vault}` catch-all.
- **`runners/src/deployer.ts`** (`SERVICE=deployer`): the scoped executor — local validation, on-chain allowlist check, simulate + `createVault`, success-receipt check, `VaultCreated` decode, CREATE2 salt from the request id, and lost-report recovery (existing code at the predicted address ⇒ report without a second tx). Holds the deploy-only key; contains no upgrade/allowlist/pause/fund selector (pinned by test). 14 new node:test units.


### Changed (governance — constitution v4.0.0: universal upgradeable wrapper family)

- **Contracts implemented (spec 049 P8):** `SparkPointUniversalVault` (universal implementation; child bound at initialization with no setter; child-claim `totalAssets`; HWM performance fee with fail-open accrual; caps + deposit-side pause; direct child unwind with a V2 `max*==0` liquidity fallback; `minSharesOut` overload; ERC-7201 storage), `SparkPointVaultFactoryV2` (fundless factory behind a Transparent proxy; curated allowlist; role-gated scoped deployer; on-chain child validation; CREATE2 BeaconProxy + per-wrapper CapRegistry; optional rolling deploy limit), plus OZ `UpgradeableBeacon` (owned by the timelock). 20 new Foundry tests (binding, gates, fee-above-HWM, loss/flat, pause-only, caps, slippage, donation, V2 fallback, beacon/factory upgrade authorization); full contracts suite **460 passed**. Not deployed — audit + operator-signed deploy remain.

- **Constitution v4.0.0 ratified** (MAJOR; operator grant 2026-09-18): NON-NEGOTIABLE **N5** is redefined from "non-upgradeable custody semantics" to **bounded, verifiable custody semantics** — a wrapper admitted under IV.5 may be upgraded **only** through a TimelockController-owned beacon (3-of-5 proposer, independent 2-of-3 canceller, ≥72h delay, no EOA), whose upgrade path is never an asset path and never gates withdrawals. Guardrails IV.5(a)/IV.6, Principle V (wrapper shapes + factory), the upgradeability constraint, and the named-contracts list are amended accordingly; single-child/no-meta-vault, allowlist admission, N1–N4, and the fee model are unchanged. Proposal: `.specify/memory/constitution-amendment-v4.0.0.md`.
- **Spec 049 (`specs/049-universal-vault-wrapper/`)** specifies the beacon fleet (`SparkPointUniversalVault` + TimelockController-owned beacon + deploy-only `SparkPointVaultFactoryV2` + `BeaconProxy` per curated vault) and the **scoped AI deployer** (deploy-only hot key held by a deterministic runner, never the keyless LLM agent). Residual risk recorded: an upgrade key can replace custody code — the timelock is a speed limit and exit window, not an impossibility proof.
- **Program roadmap** added at `docs/orchestration/vault-program-roadmap.html` (phases, status, decision log).

### Added (AI-curated vaults — spec 048, phases M2 + M4 + M3)

- **The curated store (agent, migration `0038_curated_vaults`).** Four additive tables: `curated_vaults` (screened vaults with verbatim score inputs, screening verdicts, observed APY/TVL/liquidity, status and provenance), `vault_recommendations` (one pick + alternates per run, idempotent on `run_key`; unpublished rows are AI proposals the public read ignores), `vault_curation_audit` (every admin action and run report), `vault_curation_state` (`auto_publish` — default **off**: "AI proposes, admin publishes" — last-run timestamps and the Run-now request marker). Admin edits set `provenance='admin'` and are never overwritten by a scan; the scan never writes `status` on an existing row. ⚠️ **PENDING** on develop — apply with `PGCLIENTENCODING=UTF8` before the curator runner deploys (see `MIGRATIONS.md`).
- **Public read `GET /vaults/curated`** returns `{ pick, alternates, vaults, lastRunAt, source }` with an honest empty shape. An empty board carries a note explaining WHY; figures are the stored ones (NULL stays unknown, never 0). Admin endpoints (`/admin/vaults/curation*`) mirror the tips/access panels: list, approve, deny, pin/unpin, hide, edit (provenance freeze), add-by-address (server-side rail validation), Run-now (a request marker, not a command), auto-publish toggle, audit.
- **Keyless curator runner (`runners/src/curator.ts`).** Holds no wallet: reads the agent's run-state, queries Morpho's GraphQL API (`CURATOR_CHAIN_ID`, default 4663), screens (asset allowlist, TVL, withdrawable liquidity, age, listed, anomaly guard, source warnings), scores deterministically (score → TVL → address), and publishes via the S2S admin API. Fail-open: a failed run writes only the failure state — the last good list and pick keep serving. A daily loop plus a 5-minute poll for admin "Run now". Pinned by 27 `node:test` units (live-verified: 4663 → 0 vaults, 8453 → 100 discovered / 13 accepted / deterministic pick).
- **`/vault` — wireframe A + C.** Hero "Sparky's pick today" (reason, net APY, TVL, curator, as-of), a curated table with filter + "new this week", per-row provenance chips (AI / Admin / Admin pick) and last-scan line; honest empty states that separate never-run, failed and genuinely-empty. A chat entry point opens `/chat?ask=…` with the question prefilled (the chat page reads it once and strips the URL). Deposit rail: wrapped → the wrapper page with the performance-fee disclosure; unwrapped → direct ERC-4626 with the no-fee disclosure; a claimed-but-undeployed wrapper renders "not yet", never a dead CTA. On the 4663 beta the curated board IS the vault page; the SparkPoint Aave vault stays stated as Base-only.
- **Chat answers from the curated record.** "What's the best vault? / where should I deposit?" is a deterministic route (no model call): it reads the same stored row `/vault` renders, names the pick with its stored figures and as-of, and deep-links to the board. A store outage yields an honest error block, never a remembered vault or a model-supplied APY.
- **Admin → Vaults → Curated panel.** Candidate queue with scores/failed screens, approve/deny/pin/hide, metadata editor, add-by-address, Run-now with the request/runner-boundary explained, an auto-publish toggle, and the audit log.
- **Trust Center disclosure** for off-chain AI curation, admin override, and the performance-fee-only model (fee only on gains above the high-water mark; no deposit/withdraw/flat/loss fee).
- **Ops:** optional Uptime-Kuma push heartbeat (`CURATOR_KUMA_PUSH_URL`) — the curator pings UP after a published run and DOWN when discovery fails, so a monitor alerts on a stale board, not just a live process; container healthcheck + `SERVICE=curator` support; runbook/env table in `runners/README.md`; new `runners` CI workflow (typecheck + unit tests).

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
