# Coolify — SparkPoint Pivot

Platform reference for SparkPoint Pivot on self-hosted **Coolify** (`https://coolifyadmin.aldrickb.xyz`). Release process in [DEPLOYMENT.md](./DEPLOYMENT.md).

> **DEPLOYED (web + agent) — recorded 2026-07-16 (P0/P1/P1.5).** Both the **web app AND the Hermes agent** are LIVE on OH Coolify `develop` (Coolify project **"SparkPoint Pivot" > develop**, environment_id 37, shared `coolify` network):
> | App | UUID | FQDN | Notes |
> |---|---|---|---|
> | `sparkpoint-web` (develop) | `i4cw0ogsookkkocsw808gwc4` | `https://71zxh8ed1ejf8132l46joodp17.aldrickb.app` (+ `.obrahaus-develop.aldrickb.xyz`) | full app, `SITE_LOCKED=false`; BFF at `/api/agent/*` (server-side S2S bearer) |
> | `sparkpoint-agent-develop` | `fw8s4ko4080wgk8okso8go48` | `8jcvimzny63tw81xkfl3wwmdzz.aldrickb.app` (port 8000) | hardened public FQDN: docs/openapi off, anon `/readyz`=boolean, all routes behind S2S bearer; reached only by the web BFF |
> | `spark-postgres` | (existing) | private LAN | migrations 0002/0003/0004 applied; agent connects the pool at startup, honest `/readyz` |
>
> Web env: `AGENT_INTERNAL_URL` (→ agent FQDN) + `AGENT_S2S_TOKEN` are **server-side only** (no `NEXT_PUBLIC_*`); `NEXT_PUBLIC_AGENT_BASE_URL` deleted (BFF-only). Agent env: `NEW_ANTHROPIC_OAUTH_TOKEN` (legacy `ANTHROPIC_OAUTH_TOKEN` removed), `AGENT_S2S_TOKEN`, `CORS_ALLOW_ORIGINS`, `DATABASE_URL`, `SIM_FORK_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `SPARKPOINT_VAULT_ADDRESS`. The prod/public-landing (`main`) inventory below is unchanged. NOTE: Coolify stores each env var as a build-time + runtime pair — set values via the same key on both, or use bulk update.

> **Scope note.** Coolify hosts **dev/staging only** for this client project. Production runs later on the **client's own infra/domain** (likely sparkpoint.io), TBD — see DEPLOYMENT.md. This project does **not** use obrahaus-console SSO or obrahaus-governor (sanctioned client divergences).

## Application inventory

Coolify project **3 "sparkpoint"** (new app group — group 1 = core obrahaus, 2 = fileforge, **3 = sparkpoint**). Topology per playbook §5: web app & agent service = **primary + secondary behind an nginx load balancer**; Postgres = single instance, no LB. **Ports below are FINAL** (the `3<group><env><app>` scheme is locked in); UUIDs remain _TBD_ until each app is created.

| App | Branch | Env | Coolify app UUID | Host port | Server |
|---|---|---|---|---|---|
| `sparkpoint-web-primary` | `main` | **prod · public landing (active)** | `uk0w8kkckkkok480g8808o00` | `31101` | coolify-master |
| `sparkpoint-web-secondary` | `main` | **prod · public landing (active)** | `h8cggk088co8k4400sgwcsww` | `31101` | coolify-build |
| `sparkpoint-web-lb` (nginx service) | `main` | **prod · public landing (active)** | `ncwkswsw0kgc48skgsw08488` | **`https://sparkpoint.io`** (client domain) → `31101` (ip_hash) | coolify-master |

> **✅ LIVE 2026-06-26 (feature 003, gated `SITE_LOCKED=true`).** Public landing: **https://sparkpoint.io** (client domain, live 2026-07-10 — the former Coolify auto-domain `h8cggk088co8k4400sgwcsww.aldrickb.app` is now **retired → 404**) — verified `/`→200 (landing renders), every other route→307 `/coming-soon` (incl. RSC/`.rsc`/prefetch, `noindex`, no flight leak), LB distributing across both replicas. Topology: primary (coolify-master) + secondary (coolify-build), same gated build, host port `31101`; nginx **service** LB (`ip_hash` upstream of `192.168.31.240:31101` + `192.168.31.36:31101`) owns the domain. Both replicas now have **no domain** (public domain lives only on the LB). Full as-built record + the dashboard-only domain steps + gotchas: `specs/003-landing-only-gate/deploy-runbook.md`. ⚠️ Replicas have no FQDN → a future Nixpacks rebuild can fail (`COOLIFY_URL: null`); give each an internal FQDN or set `COOLIFY_URL` if a redeploy breaks. Un-gate at launch = `SITE_LOCKED=false` on both replicas + redeploy.
| `sparkpoint-web` (**single instance — no secondary, no LB**) | `develop` | **develop · active** | `i4cw0ogsookkkocsw808gwc4` | — (served via FQDN; no host port) | coolify-master |
| `sparkpoint-agent-primary` | `main` | prod (reserved*) | _TBD_ | `31102` | coolify-master |
| `sparkpoint-agent-secondary` | `main` | prod (reserved*) | _TBD_ | `31102` | coolify-build |
| `sparkpoint-agent-primary-develop` | `develop` | develop | _TBD_ | `31202` | coolify-master |
| `sparkpoint-agent-secondary-develop` | `develop` | develop | _TBD_ | `31202` | coolify-build |
| `sparkpoint-postgres` (pgvector) | — | prod (reserved*) | _TBD_ | `31103` | coolify-build |
| `sparkpoint-postgres-develop` (pgvector) | — | develop | _TBD_ | `31203` | coolify-build |

\* **Prod (`311xx`).** The **web** prod port (`31101`) is now **ACTIVE** — it hosts the gated public landing off `main` (feature 003; `SITE_LOCKED=true`) on OH Coolify. The **agent** (`31102`) and **Postgres** (`31103`) prod ports remain **reserved**: those services run later on the **client's infra**, not OH Coolify; the block is reserved so ports don't collide if a prod-on-Coolify stage is needed.

- **Load balancers** (web + agent only): one nginx docker-compose resource per load-balanced app+env, fronting the primary+secondary pair on the shared host port (`ip_hash` sticky; include the Supabase-style large-header buffer block only if needed). Postgres is single-instance, no LB.
- **Servers (live UUIDs):** `coolify-master` = `hgwkwgoswg8o88cg8ko8ocgk` (the Coolify host; `localhost` / `host.docker.internal` / `server_id 0`; LAN IP `192.168.31.240`) and `coolify-build` = `koww4w8ok84g48s0o0ow4g8s` (`192.168.31.36` / `server_id 1`).
- **Project & environments (live):** **SparkPoint Pivot Project** = `ewwsgws4gs0ko88ocgg00ksg`; environments **`production`** = `yocok40s0ckc0cw40so0g040`, **`develop`** = `t48o0ocs80os08g4cscg0o8k`, `preview` = `pg8ok8gk44gs8c4kcgw0s84g`. Gated public-landing apps (off `main`) go in **production**; the develop apps in **develop**. Git source: ObraHaus GitHub App (`source_id: 3`, same as fileforge). **Web apps are live** — prod `sparkpoint-web-primary` (`uk0w8kkckkkok480g8808o00`) + `sparkpoint-web-secondary` (`h8cggk088co8k4400sgwcsww`) + LB `sparkpoint-web-lb` (`ncwkswsw0kgc48skgsw08488`) off `main`; develop `sparkpoint-web` (`i4cw0ogsookkkocsw808gwc4`) off `develop`. Agent + Postgres not yet created.

> **⚠️ Develop topology + gate diverge from the plan (recorded 2026-07-10).** Develop is a **single `sparkpoint-web` instance** (not the planned primary+secondary+LB pair) on the **Coolify auto-domain `http://i4cw0ogsookkkocsw808gwc4.aldrickb.app`** — the planned `sparkpoint.obrahaus-develop.aldrickb.xyz` was **never bound** (it 404s). It has **no host port** (Coolify's proxy serves its FQDN directly), `NIXPACKS_NODE_VERSION=22`. **Gate (intentional):** the develop app has **no `SITE_LOCKED` / `NEXT_PUBLIC_SITE_LOCKED` env set** → the gate is **fail-closed**, so develop is **landing-only too** — **deliberate during the development phase** (the in-progress app isn't exposed on any environment yet; the team previews locally). Flip both to `false` + redeploy only when a shared full-app preview is wanted.
- **Primary + secondary share a host port** (they run on different servers, so no collision); the nginx upstream targets both servers on that port.

### Port table — FINAL (scheme `3 <group> <env> <app>`; group `3`=sparkpoint, env `1`=prod/`2`=develop)

| App | env | host : container | host-port? |
|---|---|---|---|
| sparkpoint-web | prod / develop | `31101` / `31201` : `3000` | yes — behind nginx LB |
| sparkpoint-agent | prod / develop | `31102` / `31202` : `8080` | yes — behind nginx LB (web→agent internal calls + LAN) |
| sparkpoint-postgres (pgvector) | prod / develop | `31103` / `31203` : `5432` | yes — published for app→DB access (internal URL doesn't resolve) |

- Container ports — `web` **3000** (FINAL; Next.js `next start`); `agent` 8080 (confirm OpenClaw/Hermes' actual listen port at build time); `postgres` 5432.
- **Host ports are FINAL** per the table; only the primary/secondary of one app+env may share a port (they sit on different servers). The web LB fronts the `31101` pair (see the runbook in `specs/003-landing-only-gate/deploy-runbook.md`).
- **Reaching the DB / agent:** the internal container-name/uuid URL does **not** resolve across resources on this setup. Publish the host port, mark the DB **Proxy → "Make it publicly available"** + set the public port, restart it, then connect via the **coolify-master LAN IP `192.168.31.240`** + that port (e.g. `postgres://user:pass@192.168.31.240:31203/sparkpoint`). Same for web→agent: call `http://192.168.31.240:31202` or route via the agent's public domain.

## Domains (planned, `http://` scheme)

Set each app's domain with the **`http://` scheme, NOT `https://`** (TLS terminates upstream at Cloudflare → nginx/openresty; `https://` causes an infinite 302 redirect loop). New subdomains must also exist in **Cloudflare DNS** (`*.obrahaus-develop.aldrickb.xyz` wildcard) and the **nginx reverse proxy**.

- Web (develop) — **ACTUAL:** `http://i4cw0ogsookkkocsw808gwc4.aldrickb.app` (Coolify auto-generated `.aldrickb.app` domain). The originally-planned `http://sparkpoint.obrahaus-develop.aldrickb.xyz` was **never bound** — it returns 404; don't reference it.
- Web (prod · public landing) — **LIVE:** `https://sparkpoint.io` (the **client domain**, attached to the LB service `sparkpoint-web-lb` on 2026-07-10; TLS via Cloudflare, `http://` on the Coolify side). The former Coolify auto-domain `h8cggk088co8k4400sgwcsww.aldrickb.app` is **retired (404)**.
- Agent (develop, planned): `http://sparkpoint-agent.obrahaus-develop.aldrickb.xyz`
- ⚠️ A Nixpacks app with **no domain fails to build** (`COOLIFY_URL: null`). The agent service must be assigned an `http://` FQDN even if mostly reached over LAN; if it's ever headless, give it an internal-only FQDN (e.g. `http://sparkpoint-agent.internal`) + a tiny `/healthz` server.

## Build

- **Nixpacks** (auto-detected; Next.js / Node for web, Node for the agent service). No committed Dockerfile by default — though the agent (OpenClaw/Hermes) is "self-hosted, Docker" and may ship its own Dockerfile; if so, Coolify builds from it and the Nixpacks notes don't apply to that app.
- **Install: `pnpm install --frozen-lockfile`** (the repo will ship `pnpm-lock.yaml` — do **not** let Coolify fall back to `npm i`). Build/start commands per the app's `package.json` (TBD at build time).
- **Node pinned** via the **`NIXPACKS_NODE_VERSION`** env var (match DEVELOPMENT.md's pinned version).
- **Auto-deploy** on push to the app's branch (`develop` → develop apps).

## Environment variables

Set per-app in the **Coolify dashboard** (not the repo). Planned keys (names only — see DEVELOPMENT.md `.env.example` for the full list):
`ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` + `OPENAI_BASE_URL` for the OpenAI-compatible path), `ALCHEMY_BASE_RPC_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `DATABASE_URL` (Postgres+pgvector), `TENDERLY_*`, `SENTRY_DSN`, `DUNE_API_KEY`, `DEFILLAMA_API_KEY`, `NIXPACKS_NODE_VERSION`, `COOLIFY_URL` (auto-derived from FQDN), `SITE_LOCKED` + `NEXT_PUBLIC_SITE_LOCKED` (construction gate — see below).

### Construction gate — `SITE_LOCKED` (landing-only)

The web app ships a per-deployment **construction gate** (feature `003-landing-only-gate`): when on, only the marketing landing is public and every other route redirects to `/coming-soon`. It is **fail-closed** — anything other than `"false"` (including unset) locks the site — and read by Edge middleware at **build** time, so it MUST be set in each app's **build** environment (Coolify env vars are available at build by default).

| Web app | `SITE_LOCKED` | `NEXT_PUBLIC_SITE_LOCKED` | Result |
|---|---|---|---|
| `sparkpoint-web-*-develop` (`develop`) | `false` | `false` | full app — team/client preview |
| `sparkpoint-web-*` (`main`, public) | `true` | `true` | **landing only** |

Launch = set both to `false` on the public app and redeploy (no code change). Both keys must match per app or the landing's Connect CTA can dead-end (cosmetic only; the server gate still holds).

> **As-deployed 2026-07-10:** prod (`sparkpoint-web-primary`/`-secondary`) has `SITE_LOCKED=true` + `NEXT_PUBLIC_SITE_LOCKED=true`. **Develop (`sparkpoint-web`) has neither set** → fail-closed = **landing-only too** — **intentional** while the project is still in development (only the landing is exposed on any environment for now). When a shared full-app preview is wanted, set both to `false` on the develop app + redeploy.

### Feature 006 — force-refresh build env (ships flag-off)

The alpha web app can auto-reload stale tabs onto a new deploy + greet users with what changed (feature 006), **dormant until go-live**:
- **`NEXT_PUBLIC_FORCE_REFRESH`** — the kill-switch. Default/unset = OFF (nothing renders). Set to `"true"` in the web app's **build** env to enable the auto-reload banner + What's-New greeting.
- **Per-build version id** — `apps/web/next.config.ts` derives it automatically from `SPARKPOINT_BUILD_ID` (or Coolify's predefined `SOURCE_COMMIT`) **+ a build-frozen timestamp**, so it changes on every deploy even with no config. For a human-readable git SHA in the id, either set the **build_command** to `export SPARKPOINT_BUILD_ID=$(git rev-parse --short=8 HEAD); pnpm --filter @sparkpoint/web build`, or enable **Advanced → "Include Source Commit in Build"**. ⚠️ Coolify `4.0.0-beta.434` does **NOT** accept `include_source_commit_in_build` via the API (`PATCH …/applications/{uuid}` → `422`) — it is a UI-only toggle on this instance. The timestamp fallback means the refresh arms either way; no new **runtime** env is required (`/api/version` echoes the baked id).
- **Also:** apply migration `0014_content_slug` (yoyo, `PGCLIENTENCODING=UTF8`) and redeploy the agent so `content_seed/whats-new.json` ingests (the Dockerfile now COPYs `content_seed`).

## Verify a deploy — use the deployment record, NOT the status badge

The app `.status` badge is unreliable (apps on `coolify-build` can show `unhealthy` while serving the latest code). Use the deployment record:
```bash
TOKEN=$(grep -E '^COOLIFY_API_TOKEN=' /home/hello/project/.claude/.env | cut -d= -f2-)   # standing read token
BASE=https://coolifyadmin.aldrickb.xyz
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

Abilities: `read` · `read:sensitive` · `write` · `deploy` · `root`. **Standing token:** `/home/hello/project/.claude/.env` (`COOLIFY_API_TOKEN`) — read + read:sensitive, **read-only**. **Mutations** (creating these apps, env writes, deploys) need the RWD token (`COOLIFY_API_TOKEN_RWD`) or, for secrets/admin, a temporary `root` key. **Always ask before any Coolify-mutating call** — treat it like a `git push`.

> **LLM GATEWAY (Phase A) — recorded 2026-07-16.** Hermes no longer calls Anthropic directly; it calls an **OpenAI-compatible LiteLLM gateway → OpenRouter**. New Coolify develop resources (project "SparkPoint Pivot" > develop, env `t48o0ocs80os08g4cscg0o8k`, shared `coolify` network):
> | Resource | UUID | FQDN / host | Notes |
> |---|---|---|---|
> | `sparkpoint-litellm-develop` (app) | `fog4okko4csgscgos00ws48c` | `fi5zmq5osp0g3aam93gnv2j4rl.aldrickb.app` (port 4000) | LiteLLM proxy (build from `/services/litellm`); alias `sparkpoint-chat` → openrouter (primary `gemma-4-31b:free` + verified free fallback `gemma-4-26b-a4b:free`, router retries). image **pinned to a digest**; a same-container **guard proxy** (:4000 → LiteLLM :4001) 404s the anonymous surfaces (`/`, `/docs`, `/redoc`, `/openapi.json`, `/ui/*`) while `/chat/completions` requires the virtual key (401 without). |
> | `sparkpoint-litellm-db-develop` (postgres) | `t4w8wokwgk4ooosk0cwckg8g` | internal (`postgres:16-alpine`) | DEDICATED, isolated DB for LiteLLM keys+budgets — NOT spark-postgres, NOT the agent DB. |
>
> **Secrets (gateway env, server-side only, never committed):** `OPENROUTER_API_KEY` (ONLY the gateway holds it), `LITELLM_MASTER_KEY`, `DATABASE_URL` (→ the dedicated postgres), `DISABLE_ADMIN_UI=True`. **Agent env:** `LITELLM_BASE_URL` (→ gateway FQDN), `LITELLM_API_KEY` (a per-service **virtual key**: rpm 20 / tpm 40k / $5-a-day budget, alias `hermes-agent`), `LITELLM_MODEL=sparkpoint-chat`; `NEW_ANTHROPIC_OAUTH_TOKEN` remains as the env-selected fallback. readyz now probes the gateway's `/health/liveliness` (cached ~60s) as the `llm` check. Anonymous surface verified blocked: `/`, `/docs`, `/redoc`, `/openapi.json`, `/ui/*` → 404; `/health/liveliness` → 200; `/chat/completions` → 401 without the key.

> **AUTH / ACCESS CONTROL (Phase B) — recorded 2026-07-16.** SIWE wallet auth + a DB-backed beta/admin allowlist. New env:
> | Var | App(s) | Notes |
> |---|---|---|
> | `SESSION_SECRET` | **web** | Secret — signs the httpOnly SIWE session cookie (Web-Crypto HMAC). FAIL-CLOSED: unset ⇒ no session mints/verifies ⇒ the (app) shell + `/admin` are unreachable (only landing/connect/verify/exit/trust). Build **and** runtime (the edge middleware verifies). `openssl rand -hex 32`. |
> | `BETA_ALLOWLIST` | **agent + web** | Public csv of wallets allowed into the (app) shell. The **agent** seeds `wallet_allowlist` from it on boot; the web copy is kept in parity. |
> | `ADMIN_ALLOWLIST` | **agent + web** | Public csv of wallets allowed into `/admin` + admin APIs (admin implies beta). Same seed/parity model. |
>
> **⚠️ Sync standard.** `BETA_ALLOWLIST` / `ADMIN_ALLOWLIST` MUST be identical on the agent + web apps. **Never edit them by hand on one app** — always write both in one shot with `scripts/sync-allowlist-env.sh "<beta_csv>" "<admin_csv>"` (needs `COOLIFY_API_TOKEN_RWD`), then redeploy both so the agent re-seeds. After boot, day-to-day membership is managed live in the **admin panel** (`/admin/allowlist`, audit-logged); the env is bootstrap + disaster-recovery only. ACCESS gate only — never gates `/exit`, `/trust`, or withdraw (N2). Migrations: `0005_allowlists` (see MIGRATIONS.md).
