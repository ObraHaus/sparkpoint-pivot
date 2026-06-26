# Coolify — SparkPoint Pivot

Platform reference for SparkPoint Pivot on self-hosted **Coolify** (`https://coolifyadmin.aldrickb.xyz`). Release process in [DEPLOYMENT.md](./DEPLOYMENT.md).

> **PLANNED — not yet deployed.** The **web app (`apps/web`) now exists**, but **no Coolify apps have been created** yet. The inventory, UUIDs, domains, and ports below are a **proposal** to be confirmed when the web app is first deployed to Coolify; UUIDs are unknown until the apps exist.

> **Scope note.** Coolify hosts **dev/staging only** for this client project. Production runs later on the **client's own infra/domain** (likely sparkpoint.io), TBD — see DEPLOYMENT.md. This project does **not** use obrahaus-console SSO or obrahaus-governor (sanctioned client divergences).

## Application inventory

Proposed Coolify project **3 "sparkpoint"** (new app group — group 1 = core obrahaus, 2 = fileforge, **3 = sparkpoint**). Topology per playbook §5: web app & agent service = primary + secondary behind a load balancer; Postgres = single instance, no LB.

| App | Branch | Env | Coolify app UUID | Host port | Server |
|---|---|---|---|---|---|
| `sparkpoint-web-primary` | `main` | prod (reserved*) | _TBD_ | `31101` | coolify-master |
| `sparkpoint-web-secondary` | `main` | prod (reserved*) | _TBD_ | `31101` | coolify-build |
| `sparkpoint-web-primary-develop` | `develop` | develop | _TBD_ | `31201` | coolify-master |
| `sparkpoint-web-secondary-develop` | `develop` | develop | _TBD_ | `31201` | coolify-build |
| `sparkpoint-agent-primary` | `main` | prod (reserved*) | _TBD_ | `31102` | coolify-master |
| `sparkpoint-agent-secondary` | `main` | prod (reserved*) | _TBD_ | `31102` | coolify-build |
| `sparkpoint-agent-primary-develop` | `develop` | develop | _TBD_ | `31202` | coolify-master |
| `sparkpoint-agent-secondary-develop` | `develop` | develop | _TBD_ | `31202` | coolify-build |
| `sparkpoint-postgres` (pgvector) | — | prod (reserved*) | _TBD_ | `31103` | coolify-build |
| `sparkpoint-postgres-develop` (pgvector) | — | develop | _TBD_ | `31203` | coolify-build |

\* **Prod (`311xx`) is reserved only.** Production for this client project is intended to run on the **client's infra**, not OH Coolify; the `311xx` block is reserved so it doesn't collide if a prod-on-Coolify stage is ever needed.

- **Load balancers** (web + agent only): one nginx docker-compose resource per load-balanced app+env, fronting the primary+secondary pair on the shared host port (`ip_hash` sticky; include the Supabase-style large-header buffer block only if needed). Postgres is single-instance, no LB.
- **Servers:** `coolify-master` (the Coolify host; `localhost` / `server_id 0`; LAN IP `192.168.31.240`) and `coolify-build` (`192.168.31.36` / `server_id 1`).
- **Primary + secondary share a host port** (they run on different servers, so no collision); the nginx upstream targets both servers on that port.

### Proposed port table (scheme `3 <group> <env> <app>`; group `3`=sparkpoint, env `1`=prod/`2`=develop)

| App | env | host : container | host-port? |
|---|---|---|---|
| sparkpoint-web | prod / develop | `31101` / `31201` : `3000` | yes — behind nginx LB |
| sparkpoint-agent | prod / develop | `31102` / `31202` : `8080` | yes — behind nginx LB (web→agent internal calls + LAN) |
| sparkpoint-postgres (pgvector) | prod / develop | `31103` / `31203` : `5432` | yes — published for app→DB access (internal URL doesn't resolve) |

- Container ports are **proposals** — `web` 3000 (Next.js default); `agent` 8080 (confirm OpenClaw/Hermes' actual listen port at build time); `postgres` 5432.
- **Reserve a unique host port per app+env** and update this table before publishing. Only the primary/secondary of one app+env may share a port.
- **Reaching the DB / agent:** the internal container-name/uuid URL does **not** resolve across resources on this setup. Publish the host port, mark the DB **Proxy → "Make it publicly available"** + set the public port, restart it, then connect via the **coolify-master LAN IP `192.168.31.240`** + that port (e.g. `postgres://user:pass@192.168.31.240:31203/sparkpoint`). Same for web→agent: call `http://192.168.31.240:31202` or route via the agent's public domain.

## Domains (planned, `http://` scheme)

Set each app's domain with the **`http://` scheme, NOT `https://`** (TLS terminates upstream at Cloudflare → nginx/openresty; `https://` causes an infinite 302 redirect loop). New subdomains must also exist in **Cloudflare DNS** (`*.obrahaus-develop.aldrickb.xyz` wildcard) and the **nginx reverse proxy**.

- Web (develop): `http://sparkpoint.obrahaus-develop.aldrickb.xyz`
- Agent (develop): `http://sparkpoint-agent.obrahaus-develop.aldrickb.xyz`
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
