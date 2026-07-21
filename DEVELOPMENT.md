# Development — SparkPoint Pivot

Local development guide. Deploy: [DEPLOYMENT.md](./DEPLOYMENT.md) · Platform: [COOLIFY.md](./COOLIFY.md) · Migrations: [MIGRATIONS.md](./MIGRATIONS.md).

> **Pre-build status.** Today the repo contains only **Spec-Driven-Development artifacts** (`.specify/`, `specs/001-sparkpoint-pivot-mvp/`, `docs/`) and the design handover — **no application code yet** (build stage ⑤ not started). Everything below describing app code, scripts, monorepo layout, and env vars is **planned / TBD until the build starts**. The Spec Kit workflow (below) is usable now.

> **Client-project divergences (sanctioned).** SparkPoint Pivot is an ObraHaus **client product**, not part of the OH Apps Ecosystem (in the OH org for now; may transfer to the client). Unlike a standard OH app it:
> - **Auth = wallet auth** (Wagmi v3 + Viem · WalletConnect v2 · Coinbase Wallet SDK), **not** obrahaus-console SSO. The user's wallet is the identity; the smart account is user-owned (constitution N3). *(The current UI build wires only the `injected()` connector; WalletConnect/Coinbase land with the wallet-auth feature.)*
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
ANTHROPIC_API_KEY=              # Claude reasoning (fallback path when the gateway is unset)
# OpenAI-compatible alternative:
OPENAI_API_KEY=
OPENAI_BASE_URL=                # e.g. a self-hosted gateway endpoint

# --- LLM gateway (LiteLLM → OpenRouter) — the agent's real LLM path; see "LLM gateway" below ---
# Set on the AGENT app:
LITELLM_BASE_URL=               # gateway base URL (reachable from the agent)
LITELLM_API_KEY=                # scoped VIRTUAL chat key (low-privilege; per-wallet budgets) — used for chat
LITELLM_ADMIN_KEY=             # scoped ADMIN/management key for the admin console (NEVER the master key)
LITELLM_MODEL=sparkpoint-chat   # default alias; premium turns route to `sparkpoint-chat-premium` per-request
# Set ONLY on the GATEWAY container (never the agent/web) — the gateway is the sole key-holder:
# OPENROUTER_API_KEY  (upstream key)   LITELLM_MASTER_KEY  (root key)   DATABASE_URL  (gateway's own isolated DB)

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

## LLM gateway (LiteLLM → OpenRouter)

The agent talks to models through a self-hosted **LiteLLM** proxy (`services/litellm/config.yaml`), which fronts **OpenRouter**. The gateway is the **only** holder of the upstream `OPENROUTER_API_KEY`; the agent calls it with a scoped **virtual key**, never the master. Config lives in `services/agent/src/sparkpoint_agent/api/admin_llm.py` (admin API) + `.../llm/claude.py` + `.../llm/client.py` (chat transport).

- **Keys (three tiers, least-privilege).** `LITELLM_MASTER_KEY` (root) + `OPENROUTER_API_KEY` live **only** on the gateway container. The agent holds two scoped keys: `LITELLM_API_KEY` (the **virtual chat key** — low-privilege, per-wallet budgets, used for actual chat) and `LITELLM_ADMIN_KEY` (a **scoped admin/management key** for the console; unset ⇒ the admin tabs honestly degrade to `adminConfigured:false`, never fall back to the master or 500).
  - ⚠️ **Gotcha:** a virtual key is scoped to its own model allowlist, so `GET /model/info` **through the virtual key only returns that key's alias(es)** (e.g. just `sparkpoint-chat`). Any admin **model-list** view must use the **admin key** — this is why `/admin/llm/status` fetches the model list with `LITELLM_ADMIN_KEY` (falling back to the virtual key) while `/key/info` stays on the virtual key.
- **Aliases.** `sparkpoint-chat` (free — open models) and `sparkpoint-chat-premium` (paid — DeepSeek V4 Flash + Qwen 3.5 Flash, priced + `rpm` per deployment, with a router fallback to the free alias). `LITELLM_MODEL` sets the default; the quota dependency sets a per-request `set_model_alias(...)` contextvar (feature 008) so a **premium** turn routes to `sparkpoint-chat-premium` while free stays on `sparkpoint-chat`.
- **Admin console** (`/admin/gateway`, admin-gated → **404** to non-admins; every write is a POST, audit-logged to `gateway_audit`). Backed by these agent endpoints (BFF at `/api/agent/admin/llm/*`):
  - `GET /admin/llm/status` — reachability + model list (by alias, priced) + the virtual key's spend/limits.
  - `GET /admin/llm/stats` — spend aggregates from `/spend/logs` (the per-model report endpoint is Enterprise-gated): month-to-date, projected-month, $/day, budget-used %.
  - `GET /admin/llm/activity` — recent requests, **scrubbed** (model/tokens/spend/time; wallet masked, no prompt content).
  - `GET /admin/llm/config` · `POST /admin/llm/config/model` · `POST /admin/llm/config/model/delete` — view/add/remove deployments per alias (add takes an `alias` + input/output price + `rpm`); delete has a **per-alias last-backend guardrail** (never strands an alias with zero backends).
  - `GET /admin/llm/openrouter/price` — live OpenRouter price lookup that auto-fills the add-form.
  - `POST /admin/llm/key/config` — edit the virtual key's `max_budget` / `budget_duration` / `rpm` / `tpm` (the abuse ceiling), operator-tunable without a redeploy.
- **Deploy.** Changing `services/litellm/config.yaml` (e.g. adding a model or a price) requires the **litellm** app to redeploy; it auto-deploys on merge to `develop`. Config-file model prices/`rpm` feed LiteLLM's own cost accounting + the Config price display; real billing still passes through from OpenRouter.

## Sparky persona (agent voice)

Sparky's character lives in **`services/agent/persona_seed/*.md`** (`IDENTITY`, `SOUL`, `VOICE`, `BOUNDARIES`, `EXAMPLES`) — Obsidian-style markdown loaded by `services/agent/src/sparkpoint_agent/persona.py`, composed once into a process-stable system-prompt block, and prepended to the **literacy** agent (the only free-form-prose surface).

- **Trusted, not RAG.** Unlike `services/agent/knowledge_seed/` (the *untrusted* RAG corpus that grounds explanations), the persona is *trusted* content meant to steer voice. It is a **separate tree**, **never embedded** into `memory_chunks`, and **never on the policy/propose/build path** (enforced by `tests/coordinator/test_persona_boundary.py`). It needs **no embedder** (`EMBEDDING_OPENAI_*` unset is fine).
- **Editing.** Change a seed file and redeploy the agent, **or** edit live in the admin console (`/admin/knowledge` → **Persona** tab): admin-gated, PII-fail-closed, audited; a save upserts the isolated `persona_notes` table and **reloads Sparky's voice on the next message, no redeploy**. Overrides win over the seed until reverted.
- **Keep it on-brand.** `BOUNDARIES.md` restates the non-custody invariants (N1–N5) and the no-hype/no-emoji rules from `docs/design-handover/07-content-and-tone.md` — a test asserts the composed persona is emoji/exclamation/PII-free. Don't weaken the boundaries.
- **Env:** `SPARKPOINT_PERSONA_DIR` overrides the seed dir (tests/fixtures); persona composes from that dir + any admin overrides at boot (`warm_persona`) and on edit (`reload_persona`).

## Swap configuration (feature 007 — universal swap)

The `/swap` page and the in-chat swap are **user-signed, non-custodial, and outside the policy engine**.
Two pieces of config:

- **`swapFeeRecipient` (per-chain address book — `packages/shared/src/addresses/*.ts`).** The treasury that
  receives the **0.20% routing fee** (`ROUTING_FEE_BIPS` in `apps/web/src/lib/swap/math.ts`). A plain
  optional `AddressBook` field, **NOT** a policy `TargetRef`. Resolution is `swapFeeRecipient ?? vault.feeRecipient()`:
  where a vault exists (Base, Base Sepolia) the field is left **unset** so the recipient stays the auditable
  live vault read; on a **vault-less** chain (Robinhood 46630) it is **set** so the fee is still collected.
  It is currently the SparkPoint deployer EOA `0xA71e…5c30` (the same address the Base Sepolia vault's
  `feeRecipient()` resolves to). A zero/unset value ⇒ the fee is not activated (never sent to `0x0`); the
  fee-expectation gate is **synchronous**, so a still-loading recipient blocks the swap rather than degrading
  it to fee-free. Enabling the in-swap fee on a fork requires the router to expose `sweepTokenWithFee` +
  `unwrapWETH9WithFee` (verified on Synthra 46630, 2026-07-20).
- **`sp.swap.imported.v1` (browser `localStorage`).** The user's per-chain "imported / recently used" custom
  tokens (`apps/web/src/lib/swap/importedTokens.ts`), keyed by chainId (the same address is a different
  contract per chain), LRU-capped. Convenience only — the swap path always re-reads `decimals()` on-chain, so
  a stale cache can never mis-scale a swap.

## Dev environment

Developed in a [Coder](https://coder.com/) workspace (`testcoder.aldrickb.xyz`); forwarded ports reached at `https://<port>--<workspace-host>`.

## Conventions & security

See the constitution (`.specify/memory/constitution.md`) and the repo `CLAUDE.md`. Validate every change before a PR: `pnpm typecheck && pnpm lint && pnpm build` (+ tests; `forge test` for contracts). PRs target `develop` and are gated by the **OH Defender** scan (resolve all findings before merge). **Conventional Commits**; end every commit with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Ask before any production / Coolify-mutating action.
