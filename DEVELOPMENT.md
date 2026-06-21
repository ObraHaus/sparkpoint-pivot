# Development — SparkPoint Pivot

Local development guide. Deploy: [DEPLOYMENT.md](./DEPLOYMENT.md) · Platform: [COOLIFY.md](./COOLIFY.md) · Migrations: [MIGRATIONS.md](./MIGRATIONS.md).

> **Pre-build status.** Today the repo contains only **Spec-Driven-Development artifacts** (`.specify/`, `specs/001-sparkpoint-pivot-mvp/`, `docs/`) and the design handover — **no application code yet** (build stage ⑤ not started). Everything below describing app code, scripts, monorepo layout, and env vars is **planned / TBD until the build starts**. The Spec Kit workflow (below) is usable now.

> **Client-project divergences (sanctioned).** SparkPoint Pivot is an ObraHaus **client product**, not part of the OH Apps Ecosystem (in the OH org for now; may transfer to the client). Unlike a standard OH app it:
> - **Auth = wallet auth** (Wagmi v2 + Viem · WalletConnect v2 · Coinbase Wallet SDK), **not** obrahaus-console SSO. The user's wallet is the identity; the smart account is user-owned (constitution N3).
> - **AI = called directly** (Anthropic API / an OpenAI-compatible API, or the project's own future gateway), **not** obrahaus-governor.
> - **Brand = own** (cobalt / gold / coral, from the design handover), **not** the OH Primary design system.

## Spec-Driven Development (usable now)

Plan every feature with **Spec Kit** before code, via the `/speckit-*` Claude Code skills:
`constitution` (once) → `specify` → `clarify` → `plan` → `tasks` → `analyze` → `implement`, plus `checklist` and `agent-context-update`. The constitution is `.specify/memory/constitution.md` (currently **v1.2.0**); the launch feature is `specs/001-sparkpoint-pivot-mvp/`.

## Planned monorepo structure

Forward-looking layout for stage ⑤ (subject to the plan):

```
sparkpoint-pivot/
├── apps/
│   └── web/            # Next.js (App Router) · TailwindCSS · shadcn/ui · Wagmi/Viem · WalletConnect · Coinbase Wallet SDK
├── services/
│   └── agent/          # OpenClaw / Hermes (self-hosted, Docker) — Claude reasoning behind a deterministic policy layer
├── contracts/          # Foundry (Base) — ERC-4337 (SparkPointAccount, AccountFactory, SessionKeyValidator, PolicyModule) + SparkPointVault (ERC-4626)
├── packages/
│   └── shared/         # shared types / config / clients (chain, API)
├── .specify/  specs/  docs/   # existing planning artifacts
```

## Prerequisites (planned)

- **Node** (pinned — match the Coolify build's `NIXPACKS_NODE_VERSION`; nvm recommended). Set the exact version once the build starts.
- **pnpm** (the repo will ship `pnpm-lock.yaml`).
- **Foundry** (`forge` / `cast` / `anvil`) for `contracts/`.
- **Docker** for the agent service (OpenClaw / Hermes).
- **Postgres 16 + pgvector** (local, or point at the Coolify develop DB).

## Setup (planned)

```bash
pnpm install
cp .env.example .env.local      # fill in values
pnpm dev                        # runs apps/web (and the agent service per the workspace scripts)
```

## Environment files

- **`.env.local`** is the **active** env file the app + scripts read — it is *not* pinned to one environment; point it at local / develop depending on what you're doing.
- **`.env.develop`** holds the canonical develop values; **`.env.production`** is client-infra TBD.
- Real runtime values also live in the **Coolify app** (set in the dashboard) for dev/staging.
- ⚠️ Scripts read `.env.local` unconditionally — whatever you put there is what they hit.

### `.env.example` (planned variables)

```bash
# --- AI (called directly; NOT via obrahaus-governor) ---
ANTHROPIC_API_KEY=              # Claude reasoning for the agent service
# OpenAI-compatible alternative / future own gateway:
OPENAI_API_KEY=
OPENAI_BASE_URL=                # e.g. a self-hosted gateway endpoint

# --- Onchain / RPC (Base) ---
ALCHEMY_BASE_RPC_URL=           # Base RPC via Alchemy
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=   # WalletConnect v2 project id (browser)
NEXT_PUBLIC_BASE_CHAIN_ID=8453
TENDERLY_ACCESS_KEY=            # simulation + Web3 Actions
TENDERLY_PROJECT=
TENDERLY_ACCOUNT=

# --- Data ---
DATABASE_URL=postgres://user:pass@localhost:5432/sparkpoint   # Postgres + pgvector
DUNE_API_KEY=
DEFILLAMA_API_KEY=
# subgraph endpoints (Aave / Aerodrome) as needed

# --- Observability ---
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# --- Contract deploy (Foundry; keep deployer keys OUT of committed env) ---
BASESCAN_API_KEY=               # contract verification
# DEPLOYER_PRIVATE_KEY — use a local keystore / CI secret, never commit
```

> **Secrets hygiene.** No deployer private keys, no AI provider keys in `NEXT_PUBLIC_*`. Only WalletConnect project id and Sentry/chain-id are browser-safe (`NEXT_PUBLIC_*`).

## Scripts (planned)

| Command | What it does |
|---|---|
| `pnpm dev` | dev server(s) |
| `pnpm build` / `pnpm typecheck` / `pnpm lint` | must be green before a PR |
| `pnpm test` | unit / integration |
| `pnpm e2e` | Playwright / Puppeteer (web app) |
| `forge test` / `forge build` (in `contracts/`) | Solidity tests + build; gas snapshots |

## Database migrations

Migrations will live in a migrations dir (e.g. `services/agent/migrations/` or `packages/shared/db/migrations/`, finalized at build time); track applied state in [MIGRATIONS.md](./MIGRATIONS.md).
- Postgres + **pgvector** (one migration must `CREATE EXTENSION IF NOT EXISTS vector;`).
- Apply to a hosted env via the project's migrate command (TBD) — reach the Coolify DB via the coolify-master LAN IP + published port (see COOLIFY.md; the internal container URL does not resolve).
- ⚠️ Apply migrations to **PROD before merging to `main`**.

## Smart-contract development

- **Foundry** in `contracts/` targeting **Base**. Custom **ERC-4337** account stack (SparkPointAccount, AccountFactory, SessionKeyValidator, PolicyModule) + **SparkPointVault (ERC-4626)**; integrations limited to Aave v3 + Aerodrome at launch.
- Every change must preserve the **five non-custody invariants (N1–N5)** in the constitution. Where the custom ERC-4337 stack threatens the schedule, the mid-build checkpoint may fall back to a battle-tested AA SDK (ZeroDev/Kernel) — any fallback must preserve N1–N5.
- Simulate with **Tenderly** before any onchain action; verify on Basescan on deploy.

## Dev environment

Developed in a [Coder](https://coder.com/) workspace (`testcoder.aldrickb.xyz`); forwarded ports reached at `https://<port>--<workspace-host>`.

## Conventions & security

See the constitution (`.specify/memory/constitution.md`) and the repo `CLAUDE.md`. Validate every change before a PR: `pnpm typecheck && pnpm lint && pnpm build` (+ tests; `forge test` for contracts). PRs target `develop` and are gated by the **OH Defender** scan (resolve all findings before merge). **Conventional Commits**; end every commit with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Ask before any production / Coolify-mutating action.
