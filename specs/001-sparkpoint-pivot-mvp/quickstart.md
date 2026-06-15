# Quickstart: SparkPoint Pivot — End-to-End on Base Sepolia

**Feature**: `001-sparkpoint-pivot-mvp` | **Phase**: 1 (Design) | **Spec**: ./spec.md | **Plan**: ./plan.md

**Purpose**: Get a developer from a clean checkout to a **running, validated** SparkPoint Pivot stack on **Base Sepolia (chainId 84532)**, then walk a scripted **happy-path** that exercises the **six core user flows** and **explicitly proves the five native non-custody invariants (N1–N5)** — most importantly that **a user can withdraw with the agent service stopped**, that **every state change required a user signature**, and that **revoking a session key halts automation**.

> **Authority ordering reminder (do not violate while debugging):** for any custody-critical read or pre-sign gate, **RPC > subgraph > Dune > HTTP price API**. Postgres is a derived accelerator and is **never** on the withdrawal path. If a step below tells you to read a balance "directly from chain," do not substitute the indexer.

> **Convention:** Commands assume the **repo root** unless a `cd` is shown. Anything not yet implemented is marked **`TODO`** with the owning component. Treat every `TODO` as "the command shape is final; the code/script behind it is pending." Targets that may be missing on Base Sepolia (Aave v3, Aerodrome) fall back to a **pinned local Base-mainnet fork** per research §10 — flagged inline.

---

## 0. Prerequisites

### 0.1 Toolchain versions (pinned)

| Tool | Version | Used by | Install / check |
|------|---------|---------|-----------------|
| **Node.js** | **22.x LTS** | `apps/web`, `packages/shared`, Turborepo | `node -v` → `v22.*` (use `nvm install 22 && nvm use 22`) |
| **pnpm** | **9.x** | JS/TS workspace package manager | `corepack enable && corepack prepare pnpm@9 --activate`; `pnpm -v` |
| **uv** | **≥ 0.4** | `services/agent` Python env/deps | `curl -LsSf https://astral.sh/uv/install.sh \| sh`; `uv --version` |
| **Python** | **3.12** | agent runtime (managed by uv) | `uv python install 3.12` (uv pins it from `pyproject.toml`) |
| **Foundry** | latest (`evm_version=cancun`) | `contracts` build/test/deploy | `curl -L https://foundry.paradigm.xyz \| bash && foundryup`; `forge --version` |
| **Docker** | **≥ 24** + Compose v2 | agent + Postgres/pgvector + Anvil fork | `docker --version`; `docker compose version` |
| **git** | any recent | checkout | `git --version` |
| **jq** | any recent | reads `deployments/*/addresses.json` in scripts | `jq --version` |
| **cast** | bundled with Foundry | the non-custody drills (raw onchain reads/writes) | `cast --version` |

`.tool-versions` (asdf) and `.nvmrc` pin Node; `pyproject.toml` pins Python; `foundry.toml` pins the Solidity/EVM target. **TODO (infra):** commit `.tool-versions` + `.nvmrc` so `asdf install` / `nvm use` is one command.

### 0.2 Accounts & API keys you must obtain

| Provider | What for | Env var(s) |
|----------|----------|-----------|
| **Alchemy** | Base Sepolia RPC **and** the ERC-4337 bundler (Pimlico fallback) + an **archive** URL for the local Base-**mainnet** fork | `ALCHEMY_API_KEY`, `BASE_SEPOLIA_RPC_URL`, `BASE_MAINNET_ARCHIVE_RPC_URL`, `BUNDLER_RPC_URL` |
| **Tenderly** | mandatory pre-trade simulation (G4); the sim shown before **every** signature | `TENDERLY_ACCOUNT`, `TENDERLY_PROJECT`, `TENDERLY_ACCESS_KEY` |
| **Anthropic** | Claude reasoning for the five agents (`claude-opus-4-8`) | `ANTHROPIC_API_KEY` |
| **WalletConnect** | wallet connections in the web app (WalletConnect v2 project id) | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` |
| **BaseScan** *(optional)* | contract verification on deploy + Trust Center deep-links | `BASESCAN_API_KEY` |

> **Non-custody note on keys:** none of these are signing keys for user funds. The agent holds **no** key (N3). The only private key in this guide is a **throwaway testnet deployer/test EOA** you control — never a SparkPoint-custodied user key.

### 0.3 Testnet funds

- A **test EOA** funded with **Base Sepolia ETH** (for gas) — get it from a Base Sepolia faucet.
- **Base Sepolia test USDC** for the vault deposit flow. If a reliable USDC + Aave v3 market is **not** available on Base Sepolia at build time, the vault/Aave suites run against the **pinned local Base-mainnet fork** instead (research §10, OQ-6). **TODO (contracts/devops):** record the confirmed Base Sepolia USDC + Aave v3 Pool addresses (or the "fork-only" decision) in `contracts/script/config/base-sepolia.json` and `packages/shared/src/addresses/baseSepolia.ts`.

### 0.4 Environment variables

Copy the template and fill it in. **Never commit `.env`** (it is git-ignored; only `.env.example` is tracked).

```bash
cp .env.example .env
$EDITOR .env
```

Minimum required for an end-to-end testnet run:

```dotenv
# ---- Chain / RPC (Alchemy) ----
ALCHEMY_API_KEY=...
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}
BASE_MAINNET_ARCHIVE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}  # local fork
BUNDLER_RPC_URL=https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}               # ERC-4337 bundler
CHAIN_ID=84532

# ---- Deployer / test EOA (TESTNET ONLY — throwaway) ----
DEPLOYER_PRIVATE_KEY=0x...        # funds gas; deploys contracts on Sepolia
TEST_USER_PRIVATE_KEY=0x...       # the "user" EOA for the E2E script (sole owner of the smart account, N3)

# ---- Simulation (Tenderly) ----
TENDERLY_ACCOUNT=...
TENDERLY_PROJECT=...
TENDERLY_ACCESS_KEY=...

# ---- AI (Anthropic) ----
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-4-8

# ---- Wallet (WalletConnect v2) ----
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...

# ---- Data layer (Postgres + pgvector) ----
DATABASE_URL=postgresql://sparkpoint:sparkpoint@localhost:5432/sparkpoint
# NB: holds NO keys/secrets/signed payloads — derived index only (data-model.md §15)

# ---- Service wiring ----
AGENT_BASE_URL=http://localhost:8000
NEXT_PUBLIC_AGENT_BASE_URL=http://localhost:8000
NEXT_PUBLIC_CHAIN_ID=84532

# ---- Optional ----
BASESCAN_API_KEY=...
SENTRY_DSN=...
```

> The frontend's **custody-critical** reads (vault balance, caps, kill-switch, Trust Center, `/exit`) use `NEXT_PUBLIC_*` chain config and talk **directly** to Alchemy RPC. They are intentionally **independent** of `NEXT_PUBLIC_AGENT_BASE_URL`, so the app degrades safely when the agent is down (N2). Keep these two concerns separate while editing config.

**TODO (infra):** author `.env.example` with every var above grouped and commented; add a `pnpm env:check` (or `scripts/check-env.sh`) that validates presence/shape and **fails closed** with a readable message before any service starts.

---

## 1. Repo bootstrap

```bash
git clone <repo-url> sparkpoint-pivot
cd sparkpoint-pivot
git checkout 001-sparkpoint-pivot-mvp

# JS/TS workspace (apps/web, packages/shared) via pnpm + Turborepo
pnpm install

# Solidity deps (OpenZeppelin v5, eth-infinitism/account-abstraction, Solady, Aave/Aerodrome ifaces)
forge install            # run inside ./contracts, or via the turbo wrapper below

# Python agent env (uv-managed, Python 3.12)
uv sync --project services/agent
```

One-shot bootstrap (preferred once wired):

```bash
pnpm bootstrap     # TODO (infra): installs pnpm + forge + uv deps and generates ABIs into packages/shared
```

### 1.1 Generate the shared seam (ABIs + addresses + policy constants)

`packages/shared` is the contract⇄app seam. Foundry emits ABIs; **caps, slippage, and allowlisted addresses are defined once** and consumed by **both** the off-chain policy layer and the on-chain `PolicyModule` deploy script so they can never drift.

```bash
pnpm --filter @sparkpoint/shared gen:abis        # TODO (shared): forge build -> typed ABIs + address registry
```

This populates `packages/shared/src/addresses/{base,baseSepolia,localFork}.ts`. Until contracts are deployed (step 3), `baseSepolia.ts` carries placeholders.

---

## 2. Contracts — build, test, deploy to Base Sepolia (Foundry)

All commands run from `./contracts` (or via the `pnpm --filter @sparkpoint/contracts <script>` Turbo wrapper).

### 2.1 Build

```bash
forge build
```

### 2.2 Test — including the non-custody invariant suite (gates CI **and** deploy)

```bash
forge test -vvv

# Targeted: the N1–N5 invariant + property suite that MUST pass before any deploy
forge test --match-path 'test/invariant/*' -vvv
forge test --match-test 'invariant_noAdminCanDrain'                 # N1
forge test --match-test 'test_withdrawWorks_whenPaused_andOffline'  # N2
forge test --match-test 'test_sessionKey_rejects'                   # N4 (out-of-scope rejected on-chain)
forge test --match-test 'test_revoke_isImmediate_andUnilateral'     # N4 (instant unilateral revoke)
```

Fork-dependent suites (real Aave v3 / Aerodrome behavior) run against the **pinned Base-mainnet fork**:

```bash
forge test --match-path 'test/fork/*' \
  --fork-url "$BASE_MAINNET_ARCHIVE_RPC_URL" --fork-block-number <PINNED_BLOCK> -vvv
```

> **Why this gates deploy:** N1–N5 are enforced **by construction** (modifiers/bytecode), and the invariant suite is the machine-check that they actually hold (plan §Constitution Check). A red invariant test must **block** the deploy step below. **TODO (contracts):** wire `script/Verify` post-deploy assertions to re-run the same checks against the live Sepolia addresses.

### 2.3 Deploy to Base Sepolia

```bash
forge script script/DeployCore.s.sol:DeployCore \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --verify --etherscan-api-key "$BASESCAN_API_KEY" \
  -vvv
```

`DeployCore` deploys, in order: `CapRegistry` + `KillSwitch` (governance) → `AccountFactory` (+ `SessionKeyValidator`, `PolicyModule`) → `AaveV3Adapter` + `AerodromeAdapter` → `SparkPointVault` (ERC-4626, **non-upgradeable**, `asset = USDC`).

Then **arm guardrails** and **assert non-custody** (these steps are identical even under the ZeroDev/Kernel fallback — research §1/§10):

```bash
# Arm conservative caps (per-user TVL, total protocol, vault deposit) + wire pause-only kill-switch
forge script script/ArmGuardrails.s.sol:ArmGuardrails \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast -vvv

# Post-deploy assertion: verify N1–N5 hold against the LIVE addresses
forge script script/Verify.s.sol:Verify \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" -vvv
# Asserts (machine-checked against chain):
#   N1: no admin/sweep selector with an external `to`; vault asset-out == ERC-4626 withdraw/redeem only
#   N5: vault has NO EIP-1967 proxy/admin slots; no Upgraded/AdminChanged events; multisig wired to pause() only
#   N2: withdraw/redeem carry no pause modifier; deposit/mint/deploy do
```

Deployed addresses are written to `contracts/deployments/baseSepolia/addresses.json` (committed provenance for the Trust Center / SC-004). Sync them into the shared registry:

```bash
pnpm --filter @sparkpoint/shared sync:addresses    # TODO (shared): addresses.json -> baseSepolia.ts
```

> **TODO (contracts):** confirm EntryPoint v0.7 singleton address on Base Sepolia and the bundler's `validateUserOp` acceptance (research §2, OQ-2); v0.6 + Pimlico is the documented fallback. Pin in `script/config/base-sepolia.json`.

---

## 3. Agent service — run in Docker (agent + Postgres/pgvector [+ Anvil fork for local])

The agent service is the self-hosted Python (FastAPI) runtime hosting the five agents (portfolio reader, strategy recommender, executor, vault manager, guardrail/policy) behind the **deterministic Coordinator** and the **pure, LLM-free policy layer**. It **holds no keys** and emits only **unsigned, simulated, policy-approved** `IntentBundle`s.

```bash
# From repo root — brings up: agent (FastAPI :8000) + postgres/pgvector (:5432)
# and, for the LOCAL profile, an Anvil fork of Base mainnet (:8545)
docker compose -f infra/docker/compose.yml --env-file .env up -d --build

# Apply the data-layer schema (users, mandates, recommendations, outcome_logs, onchain_events, memory_chunks…)
docker compose -f infra/docker/compose.yml exec agent uv run alembic upgrade head   # TODO (agent): migrations

# Health check — should report db: ok, anthropic: ok, tenderly: ok, policy_version: <pinned>
curl -s "$AGENT_BASE_URL/healthz" | jq .
```

Profiles:

- `--profile testnet` (default for this guide): agent points at **Base Sepolia** via `BASE_SEPOLIA_RPC_URL`; no local Anvil.
- `--profile local`: agent + Postgres + an **Anvil fork of Base mainnet** (for the Aave/Aerodrome-dependent flows when Sepolia coverage is missing — research §10).

```bash
docker compose -f infra/docker/compose.yml --profile testnet up -d --build
```

Verify the policy layer is **fail-closed** before trusting it (a smoke test, not a substitute for `pytest`):

```bash
# Should return policy: rejected with a reason, and NO signable artifact
curl -s "$AGENT_BASE_URL/simulate" -H 'content-type: application/json' \
  -d '{"action":{"protocol":"0xUNLISTED","selector":"0xdeadbeef"}}' | jq '.policy'
# expect: { "status": "rejected", "reason": "protocol not in allowlist", ... }
```

> **TODO (agent):** `infra/docker/compose.yml`, the FastAPI `/healthz` `/chat` `/simulate` `/build-tx` `/portfolio` routes, Alembic migrations, and the `pgvector` extension bootstrap. The container image is built from `services/agent/Dockerfile` (uv-managed).

Run the agent test gates locally (outside Docker is fine):

```bash
uv run --project services/agent ruff check . && \
uv run --project services/agent mypy . && \
uv run --project services/agent pytest -q     # includes policy-layer contract tests (out-of-policy -> rejected)
```

---

## 4. Web app — run the frontend (Next.js)

```bash
pnpm --filter @sparkpoint/web dev      # Next.js App Router on http://localhost:3000
```

Open **http://localhost:3000**. Connect the **test EOA** (`TEST_USER_PRIVATE_KEY`) via WalletConnect/Coinbase Wallet/injected. On first connect the app shows the **counterfactual** smart-account address (CREATE2) before deploy.

Beta-gating note: app surfaces are whitelist- + geo-gated, **but** `middleware.ts` lets the **public** `/trust`, `/trust/permissions`, and `/exit` routes through regardless — these are the backend-independent non-custody surfaces (N2/N5, FR-044). Add the test EOA to the whitelist:

```bash
pnpm --filter @sparkpoint/web beta:whitelist -- --address <TEST_EOA_ADDRESS>   # TODO (web/agent): seeds beta_whitelist
```

> **TODO (web):** `apps/web` App Router shell, the single signing chokepoint `ExecutionDrawer`, chat cards, vault dashboard, Trust Center "prove-it" panel, and the public `/exit` direct-RPC withdraw route.

---

## 5. Scripted end-to-end happy-path validation

A **single command** drives the full happy path across all four layers on Base Sepolia, exercises the **six core flows**, and then runs the **non-custody invariant drills**. It is also the source of the E2E gate (`Playwright` against a testnet-pointed preview + `cast` for raw onchain assertions).

```bash
pnpm e2e:testnet
# TODO (e2e): orchestrator script at scripts/e2e/testnet.ts (or a Playwright project)
# Env: reads .env; uses TEST_USER_PRIVATE_KEY as the signing "user", reads addresses from
#      contracts/deployments/baseSepolia/addresses.json. Fails the run on ANY assertion miss.
```

What the script asserts, step by step. Each `✅` is a hard assertion; the run **fails** if any is missed. Every signing step records the **tx hash + the signer** so the run can later prove **"every state change required a user signature"** (SC-001).

### Phase A — The six core user flows (happy path)

**Flow 1 — Onboarding → mandate** (US3 / FR-001–004, SC-007)
- Drive the onboarding chat: answer goal = "steady yield," risk = "conservative."
- ✅ A human-readable **mandate** is generated, shown back for confirmation, and persisted (`mandates`, OFFCHAIN).
- ✅ Completed in **< 5 minutes** (SC-007 timer).

**Flow 2 — Chat assistant** (US2 entrypoint / FR-005–008)
- Ask: "What should I do with 100 USDC?"
- ✅ Response streams with a **plain-language rationale** and **citations** grounded in tool results.
- ✅ Any proposed action carries a `policy: { status: 'approved' }` stamp; unstamped blocks render **inert** (fail-closed).

**Flow 3 — Portfolio overview** (US4 / FR-009–013, SC-011)
- Open `/app/portfolio`.
- ✅ Positions, per-position + total **PnL**, and **allocation** display and **reconcile with onchain balances** read **directly via RPC** (SC-011). Empty wallet → clean empty state, no error.

**Flow 4 — Strategy recommendations** (US5 / FR-014–016, SC-005/006)
- Request recommendations.
- ✅ A **ranked** list returns, each item ranked **relative to the mandate** with a visible rationale (SC-005).
- ✅ Only **whitelisted protocols** (Aave v3, Aerodrome) appear; an out-of-policy suggestion is **rejected before** any signable artifact exists (SC-006).

**Flow 5 — Vault deposit/withdraw** (US1 / FR-017–018, the core promise)
- Deposit **USDC** into `SparkPointVault`.
- ✅ Pre-trade **Tenderly simulation** renders **before** the signature request (SC-002).
- ✅ User **signs**; shares mint in proportion to the deposit; underlying routes into **Aave v3**; dashboard shows balance + accruing yield.
- Request a **full withdrawal**.
- ✅ Shares redeem for USDC (**principal + realized yield, 0 fee**) to the **user's own wallet**.

**Flow 6 — Execution confirmation** (US2 / FR-021–024, SC-001/002)
- Trigger an **Aerodrome swap** from chat **and** an **Aave deposit**.
- ✅ Each shows a **simulation preview** (expected out, fees, price impact, max slippage) **before** signing.
- ✅ **Decline** one in the wallet → **no transaction submitted, no funds move** (FR-024).
- ✅ **Sign** the other → onchain result matches the preview within tolerance.
- ✅ Force a policy violation (e.g., slippage above max) → **Sign is disabled** and the user is told **why** (FR-023); the deterministic policy layer rejected it (FR-008/016).

> If Aave v3 / Aerodrome are not live on Base Sepolia, Flows 5–6 run against the **local Base-mainnet fork** (`--profile local`), and the gap is recorded in `research.md` (OQ-6). The assertions are identical.

### Phase B — Non-custody invariant drills (the part that makes this a *non-custody* product)

These run **after** the happy path, while the user holds a live vault position, and are the highest-signal checks in the suite.

**Drill N2 — "Withdraw works with the agent service stopped"** (FR-034, SC-003)

```bash
# 1) Stop the ENTIRE backend: agent + indexer + Postgres. Frontend can be killed too.
docker compose -f infra/docker/compose.yml stop agent postgres
# (optionally) pnpm --filter @sparkpoint/web stop      # prove independence from the frontend

# 2) Activate the kill-switch (pause NEW deployments/deposits) — withdrawals must STILL work
cast send <KILL_SWITCH_ADDR> "pause()" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"

# 3) Withdraw using ONLY the user's wallet + Alchemy RPC + the bundled ABI (no SparkPoint infra):
SHARES=$(cast call <VAULT_ADDR> "balanceOf(address)(uint256)" <TEST_EOA> --rpc-url "$BASE_SEPOLIA_RPC_URL")
cast send <VAULT_ADDR> "redeem(uint256,address,address)" "$SHARES" <TEST_EOA> <TEST_EOA> \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$TEST_USER_PRIVATE_KEY"
```

- ✅ `redeem` **succeeds while paused and with agent + Postgres + frontend down** (machine-checked twin: `test_withdrawWorks_whenPaused_andOffline`).
- ✅ The **public `/exit` route** performs the same redeem with the agent stopped (direct RPC writes; backend-independent). Re-start the frontend only to verify `/exit` standalone; the agent stays **down**.
- ✅ USDC (principal + yield) lands in the **user's own EOA**.

> This is the load-bearing claim. `withdraw`/`redeem` carry **no** `whenNotPaused` modifier and call `IPool.withdraw(...)` straight to the receiver — there is no SparkPoint contract on the path (plan §Non-custody enforcement, N2).

Restart the backend before the remaining drills:

```bash
docker compose -f infra/docker/compose.yml start postgres agent
```

**Drill N1 — "No admin can drain"** (FR-033, SC-004)

```bash
# Enumerate the vault ABI: there must be ZERO function moving the asset out with an arbitrary `to`.
jq '.abi[] | select(.type=="function")' contracts/out/SparkPointVault.sol/SparkPointVault.json \
  | jq -s '[.[] | select(.name|test("sweep|rescue|withdrawTo|adminWithdraw|skim";"i"))]'
# expect: []   (any rescue helper hard-codes to = owner(); no external-`to` asset path)
```

- ✅ **No** SparkPoint-controlled address has a withdrawal path to itself (SC-004); confirmed by ABI enumeration **and** the `invariant_noAdminCanDrain` Foundry check.
- ✅ The **Trust Center** (`/trust/permissions`) renders this exact permission set read straight from chain (SC-012, N5).

**Drill N3 — "User is the sole owner; no agent-generated wallet"** (FR-035)

```bash
cast call <SMART_ACCOUNT_ADDR> "owner()(address)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
# expect: == TEST_EOA  (the user's connected EOA, bound at factory init; no SparkPoint co-signer)
```

- ✅ `owner()` equals the user's EOA; no server-side keystore exists; the UI has no "create wallet for me" affordance.

**Drill N4 — "Revoke a session key and confirm automation halts"** (FR-029–032, SC-008)

```bash
# 1) Opt in to scoped auto-rebalance: ONE user-signed UserOp registers a session key bounded on-chain by
#    PolicyModule (allowlisted vaults only, per-tx + cumulative caps, max slippage, hard expiry).
pnpm e2e:testnet -- --only automation:enable   # user signs once

# 2) Confirm the agent CAN auto-rebalance within scope (a small in-policy rebalance executes via the session key)
pnpm e2e:testnet -- --only automation:tick
#    ✅ executes (in-scope)

# 3) Attempt an OUT-OF-SCOPE automated action (over the cumulative cap / above max slippage / non-allowlisted target)
pnpm e2e:testnet -- --only automation:tick --force-out-of-scope
#    ✅ REJECTED ON-CHAIN in validateUserOp (test_sessionKey_rejects*) — the agent cannot exceed scope even if compromised

# 4) Revoke — owner-only, instant, unilateral, WITHOUT SparkPoint's cooperation:
cast send <SMART_ACCOUNT_ADDR> "revokeSessionKey(bytes32)" <SESSION_KEY_ID> \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$TEST_USER_PRIVATE_KEY"

# 5) Confirm automation HALTS: the next agent tick fails at validation
pnpm e2e:testnet -- --only automation:tick
#    ✅ next UserOp FAILS — automation is halted immediately (test_revoke_isImmediate_andUnilateral)
```

- ✅ Revocation is **immediate and unilateral** (no SparkPoint action required), and **all** out-of-scope automated actions are rejected **on-chain** (SC-008). Let a key hit `validUntil` to also confirm ✅ **hard expiry** stops automation until explicit re-authorization (FR-032).

**Drill N5 — "Non-upgradeable + provable"** (FR-037/038, SC-012)

```bash
# EIP-1967 implementation slot on the vault MUST be empty (no proxy/admin) — vault is a plain immutable contract
cast storage <VAULT_ADDR> 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
# expect: 0x0000...0000
```

- ✅ Vault has **no** proxy/admin slot and emits no `Upgraded`/`AdminChanged`; any multisig/timelock maps to `pause()`/`unpause()` only — **no fund path** (N5).
- ✅ `/trust/permissions` surfaces caps, kill-switch status, whitelisted protocols, and exact account/vault permissions, each row deep-linked to BaseScan — non-custody is **independently verifiable** (SC-012).

### Phase C — Cross-cutting assertions (proving the spine)

- ✅ **"Every state change required a user signature"** (SC-001): the run collects every state-changing tx and asserts each was authorized by **either** the user's per-action ECDSA signature **or** an explicitly-authorized **in-scope** session key — **never** by the agent. No agent endpoint ever returned a signature or held a key.
- ✅ **Simulation-before-signature** (SC-002): for **100%** of signature requests, a Tenderly preview was rendered first.
- ✅ **Caps gate deposits, never withdrawals** (FR-025, SC-009): a deposit that would breach a cap is blocked **before signing** with a clear reason, while a withdrawal under the same paused/over-cap conditions still succeeds (cross-check with Drill N2).
- ✅ **Outcome logging** (FR-039–041, SC-010): the acted-upon recommendation produced an `outcome_log` entry that is later updated with **realized PnL** (onchain-reconstructable from `onchain_events` + a block-anchored price snapshot).
- ✅ **SRK non-essential** (FR-045, SC-013): the entire happy path completed with **SRK absent** — no core function gated on holding SRK.

---

## 6. Teardown

```bash
docker compose -f infra/docker/compose.yml down -v     # -v drops the derived Postgres data (no keys ever stored)
# Contracts on Base Sepolia persist; addresses remain in contracts/deployments/baseSepolia/addresses.json
```

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|--------|--------------|-----|
| `forge test` invariant suite red | An N1–N5 mechanism regressed | **Do not deploy.** Fix the modifier/bytecode; the suite gates deploy by design. |
| Vault/Aave flows error on Sepolia | Aave v3 / Aerodrome not live on Base Sepolia | Re-run with `--profile local` (Anvil fork of Base mainnet); record the gap in `research.md` OQ-6. |
| Signature request appears **without** a sim | Simulation gate not interposed | Bug — SC-002 violation. The `ExecutionDrawer` must block "Sign" until a Tenderly sim is attached. |
| Agent down but **portfolio/vault read** also fails | Custody-critical read wrongly routed through the agent | Bug — N2 regression. Route vault balance/caps/kill-switch reads through `lib/chain` **direct RPC**, not the agent. |
| Bundler rejects `validateUserOp` | EntryPoint v0.7 acceptance / associated-storage rules | Verify v0.7 singleton on Sepolia; fall back to v0.6 + Pimlico (research §2, OQ-2). |
| `/healthz` reports `tenderly: down` | Missing/invalid Tenderly creds | Pre-trade sim is mandatory (G4); fix creds before any execution flow — the policy layer **fails closed**. |
| `pnpm env:check` fails | Missing/malformed env var | Fill `.env` per §0.4; the check fails closed on purpose. |

---

## 8. Mapping: what this quickstart proves

| Core flow | Where validated | Key spec refs |
|-----------|-----------------|---------------|
| Onboarding | §5 Flow 1 | FR-001–004, SC-007 |
| Chat assistant | §5 Flow 2 | FR-005–008 |
| Portfolio overview | §5 Flow 3 | FR-009–013, SC-011 |
| Strategy recommendations | §5 Flow 4 | FR-014–016, SC-005/006 |
| Vault deposit/withdraw | §5 Flow 5 | FR-017–018 |
| Execution confirmation | §5 Flow 6 | FR-021–024, SC-001/002 |

| Non-custody invariant | Drill | Machine-checked twin | Key spec refs |
|-----------------------|-------|----------------------|---------------|
| N1 — No admin withdrawal | §5 Drill N1 | `invariant_noAdminCanDrain` | FR-033, SC-004 |
| N2 — Withdraw-always (agent stopped) | §5 Drill N2 | `test_withdrawWorks_whenPaused_andOffline` | FR-034, SC-003 |
| N3 — User-owned keys | §5 Drill N3 | factory init binds owner to EOA | FR-035 |
| N4 — Scoped, revocable automation | §5 Drill N4 | `test_sessionKey_rejects*`, `test_revoke_isImmediate_andUnilateral` | FR-029–032, SC-008 |
| N5 — Non-upgradeable + provable | §5 Drill N5 | empty EIP-1967 slots; permissions manifest | FR-037/038, SC-012 |

---

### Open items rolled up (all `TODO` above)

- **infra**: `.tool-versions`/`.nvmrc`, `.env.example`, `pnpm env:check`, `pnpm bootstrap`, `infra/docker/compose.yml` (agent + pgvector + Anvil-fork profiles).
- **contracts**: confirm Base Sepolia USDC + Aave v3 + Aerodrome (or "fork-only"); EntryPoint v0.7 singleton + bundler acceptance (OQ-2); `script/Verify` live post-deploy assertions.
- **shared**: `gen:abis`, `sync:addresses` into `addresses/baseSepolia.ts`.
- **agent**: Dockerfile, FastAPI routes (`/healthz` `/chat` `/simulate` `/build-tx` `/portfolio`), Alembic migrations, pgvector bootstrap.
- **web**: App Router shell, `ExecutionDrawer` (single signing chokepoint), Trust Center, public `/exit`, `beta:whitelist` seeder.
- **e2e**: `scripts/e2e/testnet.ts` (`pnpm e2e:testnet`) orchestrating Phases A–C with the `--only` / `--force-out-of-scope` flags used above.
