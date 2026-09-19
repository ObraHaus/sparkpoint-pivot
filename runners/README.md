# runners/ — the beta bots (Robinhood Chain 4663 ONLY)

One image, four services:

- **keeper** (`settle` → `sync` → batched `deliver`) and **sweeper** (royalties flush + curve/escrow
  sweeps into the 90/10 splitter). Both are **permissionless**: the bots hold only gas, and any
  holder can perform every call they make. If a bot stops, credit keeps accruing in the engine and a
  restart collects everything owed — delivery is *late, not missing*.
- **curator** (048) — the AI-curated vault discovery loop. ⚠️ **It holds NO key and signs nothing.**
  It asks the agent whether a run is due, reads Morpho's public API, screens/scores/ranks the
  vaults, and POSTs the result to the agent. Keys live only in the keeper/sweeper apps.

> **Beta channel only.** Alpha (Base Sepolia 84532) has no BrokerEngine and never runs these.
> The wallets are dedicated to 4663 (see the beta tracker); never reuse keys across channels.

## Wallets

| Role | Address | Privilege |
|---|---|---|
| keeper | `0x896D644E740154FBBB6687a4582033d04696ae0F` | none — gas only |
| sweeper | `0xEeEDB0df8Cc3D460dEccE5F02eC04b9F29fF5648` | none — gas only |

Keys live in the workspace keystore (`.claude/sparky-beta-bots.txt`), never in the repo.

The **curator** has no wallet and needs no funding. It authenticates to the agent with the shared
S2S bearer plus an operator address asserted in `X-Owner`/`X-Account` (`CURATOR_REPORT_OWNER`),
exactly like `ops/testnet-bots`. Those headers scope reads and grant no authority.

## The curator (048)

`src/curator.ts` runs a **daily** discovery (default `CURATOR_INTERVAL_SEC=86400`) and publishes the
best pick + two alternates to the agent. It is the keyless half of AI-curated vaults; the agent
holds the store and the admin panel, and the on-chain wrapper (M1) is deployed separately, by an
operator, only once a live vault exists on the chain.

- **Chain-configured.** `CURATOR_CHAIN_ID` (default **4663**). ⚠️ Morpho has **no vaults on 4663**
  today (verified 2026-09-18), so the honest result is an empty run and `/vault` says so. Re-pointing
  at a chain with vaults is configuration, not a rewrite.
- **"Run now" is a request, not a command.** Admin → Vaults sets a marker in the agent DB; the
  runner reads it on its next poll (`CURATOR_POLL_SEC`, default 300s) and runs. The agent cannot
  command this process — keep it that way.
- **Publish policy lives in the agent.** `auto_publish` OFF (the default) stores the run as a
  proposal the public cannot see; ON auto-approves AI candidates and publishes. It never overturns
  an admin's hidden/denied decision.
- **Fail-open.** A Morpho outage reports `ok=false` and writes nothing else: the last good list and
  pick keep serving (FR-011). A failed run is visible on the panel (`lastFailedAt`/detail), not
  silent.
- **Liveness.** The heartbeat file is touched after every completed poll (including an idle "not
  due" tick). Whether a *run* succeeded is on the agent — `lastRunAt` / `lastRunOk` — which is what
  the panel and the Kuma monitor read. A stopped process goes stale; a healthy idle one stays fresh.

### Curator env (Coolify, `SERVICE=curator` in the Beta Bots project)

| Key | Value |
|---|---|
| `SERVICE` | `curator` |
| `CURATOR_CHAIN_ID` | `4663` |
| `CURATOR_API_BASE_URL` | the agent's internal URL (`http://…:31102`; falls back to `AGENT_INTERNAL_URL`) |
| `AGENT_S2S_TOKEN` | same service token the web BFF uses (secret) |
| `CURATOR_REPORT_OWNER` | the operator/admin wallet asserted in the scoping headers |
| `CURATOR_INTERVAL_SEC` / `CURATOR_POLL_SEC` | `86400` / `300` |
| `CURATOR_ASSET_ALLOWLIST` | `USDC` (comma-separated symbols; on 4663 the only child asset is `USDG`) |
| `CURATOR_REQUIRE_LISTED` | `true` |
| `CURATOR_RPC_URL` | chain RPC for **P12 on-chain discovery** — the public chain RPC (`https://rpc.mainnet.chain.robinhood.com`) serves the full-range `eth_getLogs` the factory enumeration needs; unset ⇒ API-only discovery |
| `CURATOR_ARCHIVE_RPC_URL` | optional **archive** RPC (Alchemy) for the share-price APY lookback; public RPCs refuse historical `eth_call`, managed ones cap log ranges — hence the split |
| `CURATOR_VAULT_V2_FACTORY` | optional override; defaults per chain (`4663` → `0x0FBad985…803c`) |
| `CURATOR_APY_LOOKBACK_DAYS` | `7` — window for on-chain APY on vaults the API has no figure for |
| `CURATOR_STABLE_ASSETS` | `USDC,USDG,USDT,DAI` — assets valued USD 1:1 for on-chain TVL (warned, never silent) |
| `CURATOR_ONCHAIN_REQUIRED` | `true` — when the crawl is configured and fails, the run fails (last-good list stays) instead of publishing candidates whose FR-020 verification was skipped; set `false` to accept the weaker API-only degradation |
| `CURATOR_MIN_TVL_USD` / `CURATOR_MIN_LIQUIDITY_USD` | `10000` / `1000` |
| `CURATOR_MIN_AGE_DAYS` / `CURATOR_MAX_NET_APY_BPS` | `1` / `10000` |
| `CURATOR_KUMA_PUSH_URL` | optional Uptime-Kuma PUSH monitor URL; the runner pings UP after a published run and DOWN when discovery fails |
| `HEALTHCHECK_MAX_AGE_SEC` | optional override; defaults to `CURATOR_POLL_SEC * 3 + 60` |

Monitoring reads BOTH signals, and they answer different questions: the container heartbeat
(above) says "this process is alive and talking to the agent"; the Kuma push monitor says "the last
discovery run actually worked". A Morpho outage leaves the process healthy and the board stale, so
the push monitor is the one that alerts.

Pre-flight: apply migration **0038** (`MIGRATIONS.md`) and redeploy the agent **before** starting
this container — the agent must serve `/curator/run-state` + `/curator/ingest`.
Rejections are recorded on the run detail (`lastFailedDetail` / `screenedOut`), so an empty board
can be told apart from an unreachable source. The runner holds no key — do not add one.

## The AI wrapper-admission runner (049 v4.1.0 pivot)

`src/deployer.ts` (`SERVICE=deployer`) is the **scoped AI admission** runner. It holds ONE hot key
(the `DEPLOYER_ROLE` account) that can do exactly two privileged things on
`SparkPointVaultFactoryV3`: `whitelistVault(child)` — admitting a curated child that becomes
deployable only after the on-chain cooldown (default 24h, admin-bounded 1h–7d; no timelock in the
admission path) — and `createVault(params)` once that entry is ready. It **cannot unwhitelist,
release an entry, change the cooldown, upgrade anything** (factory, beacon, implementation),
pause, set recipients, or move funds — those authorities belong to the operator EOA
(`ADMIN_ROLE`) and the TimelockController (`DEFAULT_ADMIN_ROLE`), and this image has no selector
for them (pinned by test).

- Polls `GET /curator/wrapper-whitelist` (agent, S2S) for unwrapped curated candidates with their
  wrapper params, reads `wrapperOf` / `whitelistOf` / `isReady` on-chain, then per candidate:
  whitelist (no entry) → wait (AI entry cooling off) → deploy (AI entry ready); **skip** admin
  entries and already-wrapped children. Simulates, sends, waits for a success receipt, parses
  `VaultWhitelisted` / `VaultCreated`, and reports to `POST /curator/wrapper-whitelist/report`.
- **Provenance rule (off-chain):** the AI deploys ONLY entries whose on-chain `by` is its own
  address. Admin-added entries are the admin's to release/deploy; the runner skips them.
- **Idempotent:** the CREATE2 salt is derived from the child address. If code already exists at the
  predicted address (a previous attempt landed but its report was lost), it reports success WITHOUT
  sending a second transaction; a landed-but-unreported whitelist is recovered by the next tick
  (`by` is already the AI's). A reverted tx is a failure (a mined revert is not a delivery).
- **One wrapper per child** is enforced on-chain (`wrapperOf`), as is the fee/caps/child validation.
- **The agent stays keyless:** it only serves candidates and records reports. The LLM never holds
  this key.

### Deployer env (Coolify, `SERVICE=deployer`)

| Key | Value |
|---|---|
| `SERVICE` | `deployer` |
| `CHAIN_ID` | `4663` |
| `RPC_URL` | Alchemy 4663 (secret) |
| `WRAPPER_FACTORY_ADDRESS` | `SparkPointVaultFactoryV3` proxy `0x1de85106…6406` (V.7 wiring) |
| `WRAPPER_DEPLOYER_PRIVATE_KEY` | the scoped AI key (secret; gas only) |
| `AGENT_BASE_URL` | the agent's internal URL (falls back to `CURATOR_API_BASE_URL`) |
| `AGENT_S2S_TOKEN` | same service token the web BFF uses (secret) |
| `DEPLOYER_REPORT_OWNER` | the operator wallet asserted in the scoping headers |
| `DEPLOYER_POLL_SEC` | `120` |
| `WRAPPER_MAX_FEE_BPS` | `2000` |
| `HEARTBEAT_DIR` | `/tmp/sparky-beta-runners` |

Liveness follows the shared contract: a completed poll touches the heartbeat; every whitelist /
deploy / failure is reported to the agent (`wrapper_whitelist`) and visible in the panel.

## Run locally

```bash
cd runners
pnpm install
cp .env.example .env        # fill RPC_URL, the two keys, and DEPLOYMENT_PATH (absolute)
pnpm keeper                 # one terminal
pnpm sweeper                # another
```

`DEPLOYMENT_PATH` must point at `contracts/deployments/4663/addresses.json` (the beta book). The
runners read the book — never hard-code addresses into a runner; that is a runner that keeps calling
empty space after a redeploy and reports nothing wrong.

## Run as containers (Coolify)

One image, built with the **context set to `runners/`**, two apps:

```
docker build -t sparky-beta-runners runners
docker run -e SERVICE=keeper  --env-file runners/.env sparky-beta-runners
docker run -e SERVICE=sweeper --env-file runners/.env sparky-beta-runners
```

Coolify has no storage API here, so the book is supplied as **base64** (`DEPLOYMENT_JSON_B64`) and
materialized by `docker-entrypoint.sh` at start-up. `SERVICE` picks the process and the heartbeat
the `HEALTHCHECK` reads; liveness is **heartbeat file age** (a tick that completed and was not
degraded), not "is the PID alive".

### Coolify env (per app)

| Key | Value |
|---|---|
| `SERVICE` | `keeper` (app 1) / `sweeper` (app 2) |
| `DEPLOY_ENV` / `CHAIN_ID` | `mainnet` / `4663` |
| `RPC_URL` | the Chainstack **archive** endpoint (secret) |
| `DEPLOYMENT_PATH` | `/app/deployments/addresses.json` (where the entrypoint writes the book) |
| `DEPLOYMENT_JSON_B64` | base64 of `contracts/deployments/4663/addresses.json` |
| `KEEPER_PRIVATE_KEY` / `SWEEPER_PRIVATE_KEY` | the role's key (secret) |
| gas floors | keeper/sweeper `1000000000000000` wei = 0.001 ETH (warn only) |
| `SCAN_MAX_ID` | `5555` |
| `HEARTBEAT_DIR` | `/tmp/sparky-beta-runners` |

## Caveats worth knowing

- **The round is 86,400 s (daily).** `setRoundSeconds(86400)` landed with the engine upgrade on
  2026-09-16; the keeper's 60 s tick only checks the boundary, so it settles within a minute of the
  daily close. Nothing in this directory assumes a round length — the engine is asked.
- **Never read `block.number`.** On this chain the height a contract sees and the height the RPC
  serves are ~89M apart and a lookup silently returns an unrelated block. Every boundary keys on
  `block.timestamp`.
- **`deliver` is idempotent** for a broker with nothing owed, which is what makes walking the whole
  id range acceptable rather than clever. `isActive` is read in chunks (a single supply-wide
  multicall is rejected by the node and would masquerade as "nobody clocked in").
- **Post-graduation is deferred.** After the curve graduates, fees are charged by Pons' v4 hook in
  the swap's output currency, and sweeping a token-denominated leg is gated to Pons' own keeper.
  Set `PONS_HOOK` + `POOL_ID` and extend `sweeper.ts` with `sweepPool` when it matters. Nothing is
  lost — fees sit credited until swept.
- **Alert on the gas-floor warning and on heartbeat staleness**, not on the container being up. An
  unfunded or wedged runner stays "healthy" while delivering nothing.
