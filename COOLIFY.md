# Coolify — SparkPoint Pivot

Platform reference for SparkPoint Pivot on self-hosted **Coolify** (`<internal-host>`). Release process in [DEPLOYMENT.md](./DEPLOYMENT.md).

> **DEPLOYED (web + agent) — recorded 2026-07-16 (P0/P1/P1.5).** Both the **web app AND the Hermes agent** are LIVE on OH Coolify `develop` (Coolify project **"SparkPoint Pivot" > develop**, environment_id 37, shared `coolify` network):
> | App | UUID | FQDN | Notes |
> |---|---|---|---|
> | `sparkpoint-web` (develop) | `<coolify-uuid>` | `<internal-host>` (+ <internal-host>) | full app, `SITE_LOCKED=false`; BFF at `/api/agent/*` (server-side S2S bearer) |
> | `sparkpoint-agent-develop` | `<coolify-uuid>` | `<internal-host>` (port 8000) | hardened public FQDN: docs/openapi off, anon `/readyz`=boolean, all routes behind S2S bearer; reached only by the web BFF |
> | `spark-postgres` | (existing) | private LAN | migrations 0002/0003/0004 applied; agent connects the pool at startup, honest `/readyz` |
>
> Web env: `AGENT_INTERNAL_URL` (→ agent FQDN) + `AGENT_S2S_TOKEN` are **server-side only** (no `NEXT_PUBLIC_*`); `NEXT_PUBLIC_AGENT_BASE_URL` deleted (BFF-only). Agent env: `NEW_ANTHROPIC_OAUTH_TOKEN` (legacy `ANTHROPIC_OAUTH_TOKEN` removed), `AGENT_S2S_TOKEN`, `CORS_ALLOW_ORIGINS`, `DATABASE_URL`, `SIM_FORK_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `BASE_MAINNET_RPC_URL` (REQUIRED for `CHAIN_ID=8453` — there is no public default; a missing value fails closed), `SPARKPOINT_VAULT_ADDRESS`, and (024, OPTIONAL, default off) `SPARKPOINT_VAULT_REGISTRY_ENABLED` — set it to `true` only AFTER migration `0026_vault_registry` is applied and `/admin/vault-registry` reports `available: true`; with it unset the service resolves the vault from `SPARKPOINT_VAULT_ADDRESS` exactly as before, with no DB round-trip. The prod/public-landing (`main`) inventory below is unchanged.
>
> **026 (Wave 3) agent env — set at the same deploy as the 026 agent image:**
> - `PREMIUM_PRICE_SRK=10000000000000000000000` — **BASE UNITS** (10000e18), NOT `10000`. It is compared straight against the ERC-20 `Transfer` value, so `10000` would be 1e-14 SRK and would accept dust as a month of Premium. The web's `PREMIUM_PRICE_SRK_WHOLE` is `10_000n`; **web and agent must flip together** or a purchase verifies against the wrong price. (Code now defaults to 10000e18 if unset, so a forgotten env under-charges nobody — set it anyway, explicitly.)
> - `ETH_MAINNET_RPC_URL` + `SRK_MAINNET_ADDRESS` (`0x0488401c3f535193fa8df029d9ffe615a06e74e6`) + optional `SRK_GATE_MIN_BALANCE` (base units; default `1000000000000000000000000` = 1,000,000 SRK) — the login-time auto-gate that admits a ≥1M mainnet-SRK holder. **All optional:** with either of the first two unset the gate is silently skipped and non-allowlisted wallets simply see the access-application form. It is fail-open at every step and can never block a login, so it is safe to deploy the image before setting them.
> - Migration **`0029_access_applications`** should be applied before this redeploy (it is order-insensitive — an unapplied DB only breaks `/access/*` and the admin review list — but the form should work the moment it appears).
 NOTE: Coolify stores each env var as a build-time + runtime pair — set values via the same key on both, or use bulk update.

> **Scope note.** Coolify hosts **dev/staging only** for this client project. Production runs later on the **client's own infra/domain** (likely sparkpoint.io), TBD — see DEPLOYMENT.md. This project does **not** use obrahaus-console SSO or obrahaus-governor (sanctioned client divergences).

## Application inventory

Coolify project **3 "sparkpoint"** (new app group — group 1 = core obrahaus, 2 = fileforge, **3 = sparkpoint**). Topology per playbook §5: web app & agent service = **primary + secondary behind an nginx load balancer**; Postgres = single instance, no LB. **Ports below are FINAL** (the `3<group><env><app>` scheme is locked in); UUIDs remain _TBD_ until each app is created.

| App | Branch | Env | Coolify app UUID | Host port | Server |
|---|---|---|---|---|---|
| `sparkpoint-landing` (**repo `ObraHaus/sparkpoint-landing`**) | `main` | **prod · public landing (active since 2026-10-02)** | `<coolify-uuid>` | `<host-port>` | <coolify-server-b> |
| `sparkpoint-web-lb` (nginx service) | — | **prod · public landing (active)** | `<coolify-uuid>` | **`https://sparkpoint.io`** (client domain) → `<internal-host>:<host-port>` | <coolify-server-a> |
| `sparkpoint-web-primary` | `retired` | **RETIRED 2026-10-02** (stopped; branch parked so `main` pushes can't wake it) | `<coolify-uuid>` | — | <coolify-server-a> |
| `sparkpoint-web-secondary` | `retired` | **RETIRED 2026-10-02** (stopped; branch parked so `main` pushes can't wake it) | `<coolify-uuid>` | — | <coolify-server-b> |

> **✅ LIVE 2026-10-02 — sparkpoint.io is now the landing-only repo (`ObraHaus/sparkpoint-landing`).** The landing-only split: `sparkpoint.io` serves only the marketing landing from the new repo (`sparkpoint-landing` on <coolify-server-b>, host port `<host-port>`); its CTAs leave for the beta app — **Open App → `https://beta.sparkpoint.io/verify`**, **Apply for beta whitelist → `https://beta.sparkpoint.io/apply`**. The old `sparkpoint-web-primary`/`-secondary` replicas (which served the landing out of `sparkpoint-pivot` with `SITE_LOCKED=true`, and whose `/apply` had no agent/DB behind it) are **stopped** and their branch parked at `retired`. The `sparkpoint-web-lb` nginx upstream is now only `<internal-host>:<host-port>`; the service's custom Traefik label carries `Host(\`sparkpoint.io\`)` (the Coolify API can't set a compose-service domain in `4.0.0-beta.434`, so the label is baked into the service compose — see `sparkpoint-landing/README.md`). Verified `/`→200 with the new CTAs, `/apply`+`/verify`→404 (landing only), `/api/subscribe`→400 on a bad email; `beta.sparkpoint.io` untouched.
>
> _Previous record (feature 003, 2026-06-26, superseded):_ gated `SITE_LOCKED=true` landing served by primary (<coolify-server-a>) + secondary (<coolify-server-b>) behind the ip_hash LB, every non-landing route → 307 `/coming-soon`. Full as-built record: `specs/003-landing-only-gate/deploy-runbook.md`.

> **✅ LIVE 2026-06-26 (feature 003, gated `SITE_LOCKED=true`).** Public landing: **https://sparkpoint.io** (client domain, live 2026-07-10 — the former Coolify auto-domain `<internal-host>` is now **retired → 404**) — verified `/`→200 (landing renders), every other route→307 `/coming-soon` (incl. RSC/`.rsc`/prefetch, `noindex`, no flight leak), LB distributing across both replicas. Topology: primary (<coolify-server-a>) + secondary (<coolify-server-b>), same gated build, host port `<host-port>`; nginx **service** LB (`ip_hash` upstream of `<internal-host>:<host-port>` + `<internal-host>:<host-port>`) owns the domain. Both replicas now have **no domain** (public domain lives only on the LB). Full as-built record + the dashboard-only domain steps + gotchas: `specs/003-landing-only-gate/deploy-runbook.md`. ⚠️ Replicas have no FQDN → a future Nixpacks rebuild can fail (`COOLIFY_URL: null`); give each an internal FQDN or set `COOLIFY_URL` if a redeploy breaks. Un-gate at launch = `SITE_LOCKED=false` on both replicas + redeploy.
| `sparkpoint-web` (**single instance — no secondary, no LB**) | `develop` | **develop · active** | `<coolify-uuid>` | — (served via FQDN; no host port) | <coolify-server-a> |
| `sparkpoint-agent-primary` | `main` | prod (reserved*) | _TBD_ | `<host-port>` | <coolify-server-a> |
| `sparkpoint-agent-secondary` | `main` | prod (reserved*) | _TBD_ | `<host-port>` | <coolify-server-b> |
| `sparkpoint-agent-primary-develop` | `develop` | develop | _TBD_ | `31202` | <coolify-server-a> |
| `sparkpoint-agent-secondary-develop` | `develop` | develop | _TBD_ | `31202` | <coolify-server-b> |
| `sparkpoint-postgres` (pgvector) | — | prod (reserved*) | _TBD_ | `<host-port>` | <coolify-server-b> |
| `sparkpoint-postgres-develop` (pgvector) | — | develop | _TBD_ | `31203` | <coolify-server-b> |

\* **Prod (`311xx`).** The **web** prod port (`<host-port>`) is now **ACTIVE** — it hosts the gated public landing off `main` (feature 003; `SITE_LOCKED=true`) on OH Coolify. The **agent** (`<host-port>`) and **Postgres** (`<host-port>`) prod ports remain **reserved**: those services run later on the **client's infra**, not OH Coolify; the block is reserved so ports don't collide if a prod-on-Coolify stage is needed.

- **Load balancers** (web + agent only): one nginx docker-compose resource per load-balanced app+env, fronting the primary+secondary pair on the shared host port (`ip_hash` sticky; include the Supabase-style large-header buffer block only if needed). Postgres is single-instance, no LB.
- **Servers (live UUIDs):** `<coolify-server-a>` = `<coolify-uuid>` (the Coolify host; `localhost` / `host.docker.internal` / `server_id 0`; LAN IP `<internal-ip>`) and `<coolify-server-b>` = `<coolify-uuid>` (`<internal-ip>` / `server_id 1`).
- **Project & environments (live):** **SparkPoint Pivot Project** = `<coolify-uuid>`; environments **`production`** = `<coolify-uuid>`, **`develop`** = `<coolify-uuid>`, `preview` = `<coolify-uuid>`. Gated public-landing apps (off `main`) go in **production**; the develop apps in **develop**. Git source: ObraHaus GitHub App (`source_id: 3`, same as fileforge). **Web apps are live** — prod `sparkpoint-web-primary` (`<coolify-uuid>`) + `sparkpoint-web-secondary` (`<coolify-uuid>`) + LB `sparkpoint-web-lb` (`<coolify-uuid>`) off `main`; develop `sparkpoint-web` (`<coolify-uuid>`) off `develop`. Agent + Postgres not yet created.

> **⚠️ Develop topology + gate diverge from the plan (recorded 2026-07-10).** Develop is a **single `sparkpoint-web` instance** (not the planned primary+secondary+LB pair) on the **Coolify auto-domain `<internal-host>`** — the planned `<internal-host>` was **never bound** (it 404s). It has **no host port** (Coolify's proxy serves its FQDN directly), `NIXPACKS_NODE_VERSION=22`. **Gate (intentional):** the develop app has **no `SITE_LOCKED` / `NEXT_PUBLIC_SITE_LOCKED` env set** → the gate is **fail-closed**, so develop is **landing-only too** — **deliberate during the development phase** (the in-progress app isn't exposed on any environment yet; the team previews locally). Flip both to `false` + redeploy only when a shared full-app preview is wanted.
- **Primary + secondary share a host port** (they run on different servers, so no collision); the nginx upstream targets both servers on that port.

### Port table — FINAL (scheme `3 <group> <env> <app>`; group `3`=sparkpoint, env `1`=prod/`2`=develop)

| App | env | host : container | host-port? |
|---|---|---|---|
| sparkpoint-web | prod / develop | `<host-port>` / `<host-port>` : `3000` | yes — behind nginx LB |
| sparkpoint-agent | prod / develop | `<host-port>` / `31202` : `8080` | yes — behind nginx LB (web→agent internal calls + LAN) |
| sparkpoint-postgres (pgvector) | prod / develop | `<host-port>` / `31203` : `5432` | yes — published for app→DB access (internal URL doesn't resolve) |

- Container ports — `web` **3000** (FINAL; Next.js `next start`); `agent` 8080 (confirm OpenClaw/Hermes' actual listen port at build time); `postgres` 5432.
- **Host ports are FINAL** per the table; only the primary/secondary of one app+env may share a port (they sit on different servers). The web LB fronts the `<host-port>` pair (see the runbook in `specs/003-landing-only-gate/deploy-runbook.md`).
- **Reaching the DB / agent:** the internal container-name/uuid URL does **not** resolve across resources on this setup. Publish the host port, mark the DB **Proxy → "Make it publicly available"** + set the public port, restart it, then connect via the coolify host's current LAN/published endpoint from the Coolify dashboard. Same for web→agent: call the agent's current published endpoint or route via its public domain. ⚠️ **Beta DB (2026-11-02):** `sparkpoint-postgres-beta` now runs on server **`<internal-host>`**, published on <coolify-server-b> and reached from the workspace VM over **`<internal-network>`**; use its current published endpoint from the Coolify dashboard. The old `<internal-ip>` beta-DB endpoints are retired — do not reuse the former LAN IP/port.

## Domains (planned, `http://` scheme)

Set each app's domain with the **`http://` scheme, NOT `https://`** (TLS terminates upstream at Cloudflare → nginx/openresty; `https://` causes an infinite 302 redirect loop). New subdomains must also exist in **Cloudflare DNS** (`*.<internal-host>` wildcard) and the **nginx reverse proxy**.

- Web (develop) — **ACTUAL:** `<internal-host>` (Coolify auto-generated `<internal-host>` domain). The originally-planned `<internal-host>` was **never bound** — it returns 404; don't reference it.
- Web (prod · public landing) — **LIVE:** `https://sparkpoint.io` (the **client domain**, attached to the LB service `sparkpoint-web-lb` on 2026-07-10; TLS via Cloudflare, `http://` on the Coolify side). Since **2026-10-02** the upstream is the landing-only app `sparkpoint-landing` (`ObraHaus/sparkpoint-landing`, <coolify-server-b> `:<host-port>`); the old `sparkpoint-web-primary`/`-secondary` replicas are stopped. The former Coolify auto-domain `<internal-host>` is **retired (404)**; the LB's own auto-domain `<internal-host>` still serves the same landing (LB health check).
- Agent (develop, planned): `<internal-host>`
- ⚠️ A Nixpacks app with **no domain fails to build** (`COOLIFY_URL: null`). The agent service must be assigned an `http://` FQDN even if mostly reached over LAN; if it's ever headless, give it an internal-only FQDN (e.g. `http://sparkpoint-agent.internal`) + a tiny `/healthz` server.

## Build

- **Nixpacks** (auto-detected; Next.js / Node for web, Node for the agent service). No committed Dockerfile by default — though the agent (OpenClaw/Hermes) is "self-hosted, Docker" and may ship its own Dockerfile; if so, Coolify builds from it and the Nixpacks notes don't apply to that app.
- **Install: `pnpm install --frozen-lockfile`** (the repo will ship `pnpm-lock.yaml` — do **not** let Coolify fall back to `npm i`). Build/start commands per the app's `package.json` (TBD at build time).
- **Node pinned** via the **`NIXPACKS_NODE_VERSION`** env var (match DEVELOPMENT.md's pinned version).
- **Auto-deploy** on push to the app's branch (`develop` → develop apps).

## Environment variables

Set per-app in the **Coolify dashboard** (not the repo). Planned keys (names only — see DEVELOPMENT.md `.env.example` for the full list):
`ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` + `OPENAI_BASE_URL` for the OpenAI-compatible path), `ALCHEMY_BASE_RPC_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `DATABASE_URL` (Postgres+pgvector), `TENDERLY_*`, `SENTRY_DSN`, `DUNE_API_KEY`, `DEFILLAMA_API_KEY`, `NIXPACKS_NODE_VERSION`, `COOLIFY_URL` (auto-derived from FQDN), `SITE_LOCKED` + `NEXT_PUBLIC_SITE_LOCKED` (construction gate — see below).

### 076 — NEAR-only login env (names only, none set by this change)

| Name | Default | Notes |
|---|---|---|
| `NEAR_RPC_URL` | network default | Read-only `view_access_key` RPC for login. No transaction is sent. |
| `NEAR_LOGIN_RECIPIENT` | request host / `SIWE_DOMAIN` | App domain bound into the NEP-413 message; set to the deployed host. |
| `NEAR_LOGIN_TEST_MODE` | unset | TEST-ONLY server switch (skips only the on-chain key lookup; signature still verified). **Never set in production.** |
| `NEAR_LOGIN_TEST_ACCOUNT` | unset | The single account permitted to use test mode. |

The nonce table (`near_login_nonces`, migration 0045) must be applied before the agent serves NEAR logins.

### 075 — NEAR wallet env (names only, none set by this change)

| variable | default | purpose |
|---|---|---|
| `NEXT_PUBLIC_NEAR_NETWORK` | `mainnet` | `mainnet` / `testnet`; invalid ⇒ `mainnet`. |
| `NEXT_PUBLIC_NEAR_RPC_URL` | unset | OPTIONAL read-only NEAR RPC (never used to sign/broadcast). |
| `NEXT_PUBLIC_NEAR_PHASE_C_SIGN` | unset (off) | OPTIONAL Rhea Phase C NEP-413 sign-only gate. |
| `NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK` | unset | TEST-ONLY injected NEAR wallet mock for Playwright. Default unset; **never set in production**. |

The NEAR wallet is a client-side claim and is not sent to the agent. No NEAR key, seed phrase or
access key is stored: sign-in is `signInWithoutAddKey`. The app ships no CSP today; the origins a
future CSP must allow are listed in `specs/075-near-wallet-connect/research.md`.

### Construction gate — `SITE_LOCKED` (landing-only)

The web app ships a per-deployment **construction gate** (feature `003-landing-only-gate`): when on, only the marketing landing is public and every other route redirects to `/coming-soon`. It is **fail-closed** — anything other than `"false"` (including unset) locks the site — and read by Edge middleware at **build** time, so it MUST be set in each app's **build** environment (Coolify env vars are available at build by default).

| Web app | `SITE_LOCKED` | `NEXT_PUBLIC_SITE_LOCKED` | Result |
|---|---|---|---|
| `sparkpoint-web-*-develop` (`develop`) | `false` | `false` | full app — team/client preview |
| `sparkpoint-web-*` (`main`, public) | `true` | `true` | **landing only** |

Launch = set both to `false` on the public app and redeploy (no code change). Both keys must match per app or the landing's Connect CTA can dead-end (cosmetic only; the server gate still holds).

> **As-deployed 2026-07-10:** prod (`sparkpoint-web-primary`/`-secondary`) has `SITE_LOCKED=true` + `NEXT_PUBLIC_SITE_LOCKED=true`. **Develop (`sparkpoint-web`) has neither set** → fail-closed = **landing-only too** — **intentional** while the project is still in development (only the landing is exposed on any environment for now). When a shared full-app preview is wanted, set both to `false` on the develop app + redeploy.

### Feature 006 — force-refresh build env (LIVE on develop, dark on prod)

The web app can auto-reload stale tabs onto a new deploy + greet users with what changed (feature 006). **LIVE on develop since 2026-07-20** (`NEXT_PUBLIC_FORCE_REFRESH=true`); dormant on any env where the flag is unset:
- **`NEXT_PUBLIC_FORCE_REFRESH`** — the kill-switch. Default/unset = OFF (nothing renders). Set to `"true"` in the web app's **build** env to enable the auto-reload banner + What's-New greeting.
- **Per-build version id** — `apps/web/next.config.ts` derives it automatically as `<SOURCE_COMMIT>-<build-frozen timestamp>`, so it changes on every deploy even with no config. **Confirmed on develop:** Coolify **does** expose `SOURCE_COMMIT` to the Nixpacks build here, so `/api/version` returns the real commit SHA + timestamp — **no extra wiring needed**. (The optional `build_command` `git rev-parse --short=8 HEAD` returns empty in the Nixpacks context, and the API rejects the *"Include Source Commit in Build"* toggle on `4.0.0-beta.434` (`422`) — but neither is needed since `SOURCE_COMMIT` already works.) `/api/version` echoes the baked id with `no-store`; no new **runtime** env required.
- **Also:** apply migration `0014_content_slug` (yoyo, `PGCLIENTENCODING=UTF8`) **before** the agent boots, and redeploy the agent so `content_seed/whats-new.json` ingests (the Dockerfile COPYs `content_seed`). If the agent booted first, restart it to re-ingest (see [DEPLOYMENT.md](./DEPLOYMENT.md) → "Feature 006 — how to deploy").

> **As-deployed 2026-07-20:** develop web app (`<coolify-uuid>`) has `NEXT_PUBLIC_FORCE_REFRESH=true` and `0014` applied. ⚠️ The env-create API rejects `is_build_time` on this Coolify — POST `{key,value}` only, and set the env **then** redeploy (a deploy triggered before the env builds dark). Prod (`main` replicas) is **unset** (dark) — a separate go/no-go; enable it on **both** replicas like `SITE_LOCKED`.

## Verify a deploy — use the deployment record, NOT the status badge

The app `.status` badge is unreliable (apps on `<coolify-server-b>` can show `unhealthy` while serving the latest code). Use the deployment record:

> **⚠️ KNOWN BUG — ignore the badge on the prod landing replicas (recorded 2026-09-16).** `sparkpoint-web-primary` can show **`exited:unhealthy`** and `sparkpoint-web-secondary` **`running:unhealthy`** while `https://sparkpoint.io` serves correctly through the LB. This is a **Coolify system bug, operator-confirmed** — do NOT chase it, restart, or redeploy because of it. Verify with the deployment record (`status: finished`) + the served page instead.
```bash
# Token env names (verified 2026-07-30): there is NO bare `COOLIFY_API_TOKEN`.
#   COOLIFY_API_TOKEN_READ_READSENSITIVE — reads, incl. an app's env values (used below)
#   COOLIFY_API_TOKEN_RWD               — read/write/deploy (POST /api/v1/deploy)
TOKEN="${COOLIFY_API_TOKEN_READ_READSENSITIVE:?set the read token in your environment}"
BASE=<internal-host>
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/deployments" \
  | jq -r '.[] | "\(.application_name) \(.status) \(.deployment_uuid)"'     # active builds → uuid
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/deployments/<uuid>" \
  | jq '{application_name, status, commit_message, finished_at}'            # status: finished = success
```
`status: finished` = success. Build/debug logs are **not** available via the API (`logs: null`) — read them in the Coolify UI → Application → Deployments → Show Debug Logs (ask the human to paste them when a deploy fails). Runtime logs of a *running* app: `GET /api/v1/applications/{uuid}/logs?lines=N`.

## Scheduled tasks

Managed in the **Coolify UI** (the scheduled-tasks API isn't exposed). Record them here. **Planned candidates** (none created yet):

| Task | App | Command | Frequency | Purpose |
|---|---|---|---|---|
| _data-sync (planned)_ | `sparkpoint-agent` | _TBD_ | _TBD_ | Pull Dune / DeFiLlama / subgraph data, refresh pgvector embeddings |
| _vault-health (planned)_ | `sparkpoint-agent` | _TBD_ | _TBD_ | Periodic vault/position health + high-water-mark checks |

## REST API / token

Abilities: `read` · `read:sensitive` · `write` · `deploy` · `root`. **Standing token:** `<secrets-env-file>` (`COOLIFY_API_TOKEN`) — read + read:sensitive, **read-only**. **Mutations** (creating these apps, env writes, deploys) need the RWD token (`COOLIFY_API_TOKEN_RWD`) or, for secrets/admin, a temporary `root` key. **Always ask before any Coolify-mutating call** — treat it like a `git push`.

> **LLM GATEWAY (Phase A) — recorded 2026-07-16.** Hermes no longer calls Anthropic directly; it calls an **OpenAI-compatible LiteLLM gateway → OpenRouter**. New Coolify develop resources (project "SparkPoint Pivot" > develop, env `<coolify-uuid>`, shared `coolify` network):
> | Resource | UUID | FQDN / host | Notes |
> |---|---|---|---|
> | `sparkpoint-litellm-develop` (app) | `<coolify-uuid>` | `<internal-host>` (port 4000) | LiteLLM proxy (build from `/services/litellm`); aliases from the shared config — `sparkpoint-chat` free group, restored **2026-10-27**: `nvidia/nemotron-3-ultra-550b-a55b:free` (primary) + `cohere/north-mini-code:free` + `poolside/laguna-s-2.1:free` (fallbacks, three different providers); `sparkpoint-chat-premium` (`google/gemini-2.5-flash-lite` + `openai/gpt-oss-120b`), `sparkpoint-selfauthor` (same paid pair) → openrouter. Router retries across the group and `enable_weighted_failover` re-picks another deployment on a 404/429; no free → paid fallback is configured. image **pinned to a digest**; a same-container **guard proxy** (:4000 → LiteLLM :4001) 404s the anonymous surfaces (`/`, `/docs`, `/redoc`, `/openapi.json`, `/ui/*`) while `/chat/completions` requires the virtual key (401 without). |
> | `sparkpoint-litellm-db-develop` (postgres) | `<coolify-uuid>` | internal (`postgres:16-alpine`) | DEDICATED, isolated DB for LiteLLM keys+budgets — NOT spark-postgres, NOT the agent DB. |
>
> **Secrets (gateway env, server-side only, never committed):** `OPENROUTER_API_KEY` (ONLY the gateway holds it), `LITELLM_MASTER_KEY`, `DATABASE_URL` (→ the dedicated postgres), `DISABLE_ADMIN_UI=True`. **Agent env:** `LITELLM_BASE_URL` (→ gateway FQDN), `LITELLM_API_KEY` (a per-service **virtual key**: rpm 20 / tpm 40k / $5-a-day budget, alias `hermes-agent`), `LITELLM_MODEL=sparkpoint-chat`; `NEW_ANTHROPIC_OAUTH_TOKEN` remains as the env-selected fallback. readyz now probes the gateway's `/health/liveliness` (cached ~60s) as the `llm` check. Anonymous surface verified blocked: `/`, `/docs`, `/redoc`, `/openapi.json`, `/ui/*` → 404; `/health/liveliness` → 200; `/chat/completions` → 401 without the key.

> **AUTH / ACCESS CONTROL (Phase B) — recorded 2026-07-16.** SIWE wallet auth + a DB-backed beta/admin allowlist. New env:
> | Var | App(s) | Notes |
> |---|---|---|
> | `SESSION_SECRET` | **web** | Secret — signs the httpOnly SIWE session cookie (Web-Crypto HMAC). FAIL-CLOSED: unset ⇒ no session mints/verifies ⇒ the (app) shell + `/admin` are unreachable (only landing/connect/verify/exit/trust). Build **and** runtime (the edge middleware verifies). `openssl rand -hex 32`. |
> | `BETA_ALLOWLIST` | **agent + web** | Public csv of wallets allowed into the (app) shell. The **agent** seeds `wallet_allowlist` from it on boot; the web copy is kept in parity. |
> | `ADMIN_ALLOWLIST` | **agent + web** | Public csv of wallets allowed into `/admin` + admin APIs (admin implies beta). Same seed/parity model. |
> | `BETA_OPEN` | **web** | **PUBLIC BETA switch (2026-10-04).** Exact `"true"` admits EVERY wallet that completes SIWE to the (app) shell — the allowlist/application/SRK gate no longer restricts entry. FAIL-CLOSED: unset/anything else keeps the allowlist. Never widens admin (that stays `ADMIN_ALLOWLIST`/DB). Build + runtime env — set it, then **redeploy the web app**. |
>
> **⚠️ Sync standard.** `BETA_ALLOWLIST` / `ADMIN_ALLOWLIST` MUST be identical on the agent + web apps. **Never edit them by hand on one app** — always write both in one shot with `scripts/sync-allowlist-env.sh "<beta_csv>" "<admin_csv>"` (needs `COOLIFY_API_TOKEN_RWD`), then redeploy both so the agent re-seeds. After boot, day-to-day membership is managed live in the **admin panel** (`/admin/allowlist`, audit-logged); the env is bootstrap + disaster-recovery only. ACCESS gate only — never gates `/exit`, `/trust`, or withdraw (N2). Migrations: `0005_allowlists` (see MIGRATIONS.md).
>
> **✅ OPEN BETA — LIVE 2026-10-04.** `sparkpoint-web-beta` (`<coolify-uuid>`, `main`,
> build+runtime env `BETA_OPEN=true`) now serves beta.sparkpoint.io to **every wallet** — the
> allowlist, `/apply`, and the 1M-SRK auto-gate no longer restrict entry (sign-in is still required:
> it proves wallet control). Shipped via PRs #294/#295 (`main` @ `584a2ba`, `/api/version` matches);
> verified live with a freshly generated wallet (SIWE `beta:true` → `/chat` 200, `/admin` 404).
> Admin is unchanged. The allowlist + `/apply` remain for the alpha/develop builds and for future
> re-gating (`BETA_OPEN=false`/unset + redeploy).
