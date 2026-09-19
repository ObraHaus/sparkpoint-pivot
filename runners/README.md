# runners/ — the beta revenue bots (Robinhood Chain 4663 ONLY)

One image, two processes — **keeper** (`settle` → `sync` → batched `deliver`) and **sweeper**
(royalties flush + curve/escrow sweeps into the 90/10 splitter). Both are **permissionless**: the
bots hold only gas, and any holder can perform every call they make. If a bot stops, credit keeps
accruing in the engine and a restart collects everything owed — delivery is *late, not missing*.

> **Beta channel only.** Alpha (Base Sepolia 84532) has no BrokerEngine and never runs these.
> The wallets are dedicated to 4663 (see the beta tracker); never reuse keys across channels.

## Wallets

| Role | Address | Privilege |
|---|---|---|
| keeper | `0x896D644E740154FBBB6687a4582033d04696ae0F` | none — gas only |
| sweeper | `0xEeEDB0df8Cc3D460dEccE5F02eC04b9F29fF5648` | none — gas only |

Keys live in the workspace keystore (`.claude/sparky-beta-bots.txt`), never in the repo.

## The wrapper deploy runner (049)

`src/deployer.ts` (`SERVICE=deployer`) is the **scoped** executor for wrapper deployments requested
in Admin → Vaults. It holds ONE hot key that can do exactly one privileged thing: call
`createVault` on `SparkPointVaultFactoryV2` for a child **already on the curated on-chain
allowlist**, with fee ≤ cap and caps within bounds. It **cannot upgrade anything** (factory, beacon,
implementation), change the allowlist, pause, set recipients, or move funds — those authorities
belong to the TimelockController, and this image has no selector for them.

- Polls `GET /curator/wrapper-jobs` (agent, S2S), validates locally, checks the on-chain allowlist,
  simulates, sends, waits for a success receipt, parses `VaultCreated`, and reports to
  `POST /curator/wrapper-jobs/report`.
- **Idempotent:** the CREATE2 salt is derived from the request id. If code already exists at the
  predicted address (a previous attempt landed but its report was lost), it reports success WITHOUT
  sending a second transaction. A reverted tx is a failure (a mined revert is not a delivery).
- **The agent stays keyless:** it only queues and records. The LLM never holds this key.

### Deployer env (Coolify, `SERVICE=deployer`)

| Key | Value |
|---|---|
| `SERVICE` | `deployer` |
| `CHAIN_ID` | `4663` |
| `RPC_URL` | Alchemy 4663 (secret) |
| `WRAPPER_FACTORY_ADDRESS` | `SparkPointVaultFactoryV2` proxy (set after the P10 deploy) |
| `WRAPPER_DEPLOYER_PRIVATE_KEY` | the scoped deploy-only key (secret; gas only) |
| `AGENT_BASE_URL` | the agent's internal URL (falls back to `CURATOR_API_BASE_URL`) |
| `AGENT_S2S_TOKEN` | same service token the web BFF uses (secret) |
| `DEPLOYER_REPORT_OWNER` | the operator wallet asserted in the scoping headers |
| `DEPLOYER_POLL_SEC` | `120` |
| `WRAPPER_MAX_FEE_BPS` | `2000` |
| `HEARTBEAT_DIR` | `/tmp/sparky-beta-runners` |

Liveness follows the shared contract: a completed poll touches the heartbeat; whether a DEPLOY
succeeded is reported to the agent (`wrapper_deployments`) and visible in the panel.

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
