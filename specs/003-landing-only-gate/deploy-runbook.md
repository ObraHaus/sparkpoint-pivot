# Deploy Runbook — gated public landing (feature 003)

One-time stand-up of the **landing-only public deployment** off `main`. The code is already on `main` (gate included); this runbook only creates and configures the Coolify app. Living references: [COOLIFY.md](../../COOLIFY.md), [DEPLOYMENT.md](../../DEPLOYMENT.md).

> **Review gate:** nothing here is executed until you approve. Coolify **mutations** need the RWD token (the standing token is read-only); **DNS + nginx** are operator-owned. Steps are tagged **[me]** (I can run via the Coolify API once you approve + provide the RWD token) or **[operator]** (aldrickb).

## Decision: minimal first cut (recommended)

COOLIFY.md's inventory plans a primary+secondary pair behind an nginx LB. For a **static-ish landing**, that's overkill today. Recommend **one app now**, add the LB/secondary later if/when the full app launches (YAGNI / Principle VII).

| App | Branch | Build base | Container port | Host port | Server | Gate |
|---|---|---|---|---|---|---|
| `sparkpoint-web` (public) | `main` | `apps/web` | 3000 | `31101` (from COOLIFY.md reserved block) | coolify-master | `SITE_LOCKED=true` |

(Keep `sparkpoint-web-*-develop` off `develop` with `SITE_LOCKED=false` for team preview — create whenever convenient; not required for this landing.)

## Prerequisites

- [ ] **[operator]** RWD Coolify token available (`COOLIFY_API_TOKEN_RWD`) for the mutating calls, OR operator runs the dashboard steps.
- [ ] **[operator]** Confirm host port `31101` is free on coolify-master (per COOLIFY.md port scheme).
- [ ] Today is **not a no-deploy day** — operator already approved this Friday exception.

## Steps

### 1. Create the app — **[me]** (API) or **[operator]** (dashboard)
- Project **"sparkpoint"** (group 3). Source: GitHub `ObraHaus/sparkpoint-pivot`, branch **`main`**.
- Build pack: **Nixpacks**. **Base directory: `apps/web`** (self-contained Next app with its own `pnpm-lock.yaml`).
- Install: `pnpm install --frozen-lockfile` · Build: `pnpm build` (`next build`) · Start: `pnpm start` (`next start`).
- Auto-deploy on push to `main`: **on**.

### 2. Environment variables (set BEFORE first build) — **[me]**/**[operator]**
The gate is read by Edge middleware **at build time**, so these must be present in the **build** env:
```
SITE_LOCKED=true
NEXT_PUBLIC_SITE_LOCKED=true
NIXPACKS_NODE_VERSION=22        # match DEVELOPMENT.md
# COOLIFY_URL is auto-derived from the assigned FQDN
```
(No `ANTHROPIC_*` / `DATABASE_URL` / RPC keys needed yet — the landing is static mock UI.)

### 3. Domain — **[operator]**
- Assign an **`http://`** FQDN (TLS terminates upstream; `https://` causes a redirect loop — see COOLIFY.md). Proposed: `http://sparkpoint.aldrickb.xyz` (or the client-facing subdomain you prefer).
- **[operator]** Add the subdomain to **Cloudflare DNS** and the **nginx reverse proxy**. ⚠️ A Nixpacks app with no domain fails to build (`COOLIFY_URL: null`).

### 4. Deploy — **[me]** (trigger) / **[operator]**
- Trigger the deploy (push already happened; a manual deploy may be needed for first build).

### 5. Verify — **[me]**
- Deployment record (not the status badge): `GET /api/v1/deployments/<uuid>` → `status: finished` (read token in `/home/hello/project/.claude/.env`).
- Public gate smoke against the live URL:
  ```
  curl -s -o /dev/null -w "%{http_code}  /\n"      http://<fqdn>/            # 200, landing
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}  /admin\n" http://<fqdn>/admin   # 307 -> /coming-soon
  curl -s -o /dev/null -w "%{http_code}  /coming-soon\n" http://<fqdn>/coming-soon       # 200
  ```
  Then load `/` in a browser: the Three.js landing renders; the Connect CTA goes to `/coming-soon`, not a dead route.

## Rollback / un-gate
- **Un-gate at launch:** set `SITE_LOCKED=false` **and** `NEXT_PUBLIC_SITE_LOCKED=false`, redeploy. No code change.
- **Rollback:** redeploy the previous good deployment in Coolify, or `git revert` on `main` (Coolify redeploys on push).

## What I will NOT do without explicit per-call approval
- Any Coolify-mutating API call (create app, set env, trigger deploy) — I'll show each call first.
- Anything touching Cloudflare DNS or nginx (operator-owned).
