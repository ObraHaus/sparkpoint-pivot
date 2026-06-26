# Deploy Runbook — gated public landing (feature 003)

One-time stand-up of the **landing-only public deployment** off `main`, in the **full primary + secondary + nginx LB** topology (playbook §5). The code is already on `main` (gate included); this runbook creates and configures the Coolify resources. Living references: [COOLIFY.md](../../COOLIFY.md), [DEPLOYMENT.md](../../DEPLOYMENT.md).

> **Review gate:** nothing here is executed until you approve. Coolify **mutations** need the RWD token (the standing token is read-only); **DNS + nginx** are operator-owned. Steps are tagged **[me]** (I can run via the Coolify API once you approve + provide the RWD token) or **[operator]** (aldrickb).

## Topology + FINAL ports

Per COOLIFY.md inventory — web prod block `31101` is now **active** for this landing.

| Resource | Server | Host : container | Branch | Gate |
|---|---|---|---|---|
| `sparkpoint-web-primary` | coolify-master (`192.168.31.240`) | `31101` : `3000` | `main` | `SITE_LOCKED=true` |
| `sparkpoint-web-secondary` | coolify-build (`192.168.31.36`) | `31101` : `3000` | `main` | `SITE_LOCKED=true` |
| `sparkpoint-web-lb` (nginx docker-compose) | coolify-master | public domain → `ip_hash` upstream of both | — | — |

The primary and secondary run the **same gated build** on different servers, sharing host port `31101`; the nginx LB fronts them and owns the public domain.

```nginx
# sparkpoint-web-lb upstream (ip_hash sticky)
upstream sparkpoint_web {
  ip_hash;
  server 192.168.31.240:31101;   # primary  (coolify-master)
  server 192.168.31.36:31101;    # secondary (coolify-build)
}
# server { listen 80; server_name <fqdn>; location / { proxy_pass http://sparkpoint_web; ... } }
```

## Live Coolify IDs (read-only, fetched 2026-06-26)

| Thing | Value |
|---|---|
| Project | **SparkPoint Pivot Project** = `ewwsgws4gs0ko88ocgg00ksg` (apps list currently empty) |
| Environment (use this) | **`production`** = `yocok40s0ckc0cw40so0g040` |
| Other envs | `develop` = `t48o0ocs80os08g4cscg0o8k` · `preview` = `pg8ok8gk44gs8c4kcgw0s84g` |
| Server — primary | **coolify-master** = `hgwkwgoswg8o88cg8ko8ocgk` (`localhost`/`host.docker.internal`; LAN `192.168.31.240`) |
| Server — secondary | **coolify-build** = `koww4w8ok84g48s0o0ow4g8s` (`192.168.31.36`) |
| Git source | ObraHaus GitHub App, **`source_id: 3`** (same source as `obrahaus/fileforge-docs`; github_app_uuid confirmed in the dashboard dropdown at create) |

## Status (executed 2026-06-26)

| Step | State |
|---|---|
| `sparkpoint-web-primary` (coolify-master) created · gated · deployed | ✅ uuid `uk0w8kkckkkok480g8808o00` — **live + gate verified** at `https://sparkpoint-landing.obrahaus-develop.aldrickb.xyz` |
| `sparkpoint-web-secondary` (coolify-build) created · gated · deployed | ✅ uuid `h8cggk088co8k4400sgwcsww` — running (`next start` ✓ Ready; badge `running:unhealthy` = coolify-build false-negative); reached via host port `31101` for the LB |
| Env on both (`SITE_LOCKED=true`, `NEXT_PUBLIC_SITE_LOCKED=true`, `NIXPACKS_NODE_VERSION=22`) | ✅ build-time (`is_buildtime: true`) |
| **nginx LB + real public domain** (steps 3–4 below) | ⏳ **operator** — needs Cloudflare DNS + nginx |

The gated landing is **already publicly reachable** at the primary's staging URL above. The steps below finish the HA topology (LB) and swap in the real public domain.

> **Note for future me:** the env API on this Coolify rejects `is_build_time` (422); the accepted shape is `{key,value}` and Coolify defaults new vars to `is_buildtime:true` + `is_runtime:true`. coolify-build apps are **not** reachable by their own FQDN (the Cloudflare wildcard + nginx point at coolify-master); reach/verify them via host port `31101` on `192.168.31.36`, or through the LB.

## Prerequisites

- [ ] **[operator]** RWD Coolify token (`COOLIFY_API_TOKEN_RWD`) for the mutating calls, OR operator runs the dashboard steps.
- [ ] **[operator]** Confirm host port `31101` is free on **both** coolify-master and coolify-build.
- [ ] Public FQDN chosen (default proposed: `http://sparkpoint.aldrickb.xyz`).
- [ ] Friday no-deploy exception already approved by the operator for this landing.

## Steps

### 1. Create the two app resources — **[me]** (API) / **[operator]** (dashboard)

Create **two** applications in project **SparkPoint Pivot Project** → environment **`production`** (`yocok40s0ckc0cw40so0g040`) — `sparkpoint-web-primary` on **coolify-master**, `sparkpoint-web-secondary` on **coolify-build**. Identical config except name + server:

| Field | Value |
|---|---|
| Project | `ewwsgws4gs0ko88ocgg00ksg` (SparkPoint Pivot Project) |
| Environment | **`production`** (`yocok40s0ckc0cw40so0g040`) |
| Server | primary → `hgwkwgoswg8o88cg8ko8ocgk` (coolify-master) · secondary → `koww4w8ok84g48s0o0ow4g8s` (coolify-build) |
| Source | ObraHaus GitHub App (`source_id: 3`) → `ObraHaus/sparkpoint-pivot`, branch **`main`** |
| Build pack | **Nixpacks**, **Base directory `/apps/web`** |
| Commands | install `pnpm install --frozen-lockfile` · build `pnpm build` · start `pnpm start` |
| Ports | exposes **`3000`** (container); host **`31101`** |
| Auto-deploy on push to `main` | on |

**Dashboard [operator]:** `+ New` → in **SparkPoint Pivot Project / Production** → Private Repository (GitHub App **ObraHaus**) → `ObraHaus/sparkpoint-pivot` → branch `main` → Nixpacks → Base Directory `/apps/web` → Port `3000` → pick the server. Repeat for the second server.

**API [me, needs RWD token]:** create against the **production** environment (confirm the GitHub-App-source field shape with the RWD token before firing — `obrahaus/fileforge-docs` uses `source_id: 3` with `github_app_uuid: null`):
```bash
curl -X POST "$BASE/api/v1/applications/private-github-app" \
  -H "Authorization: Bearer $RWD" -H "Content-Type: application/json" -d '{
    "project_uuid": "ewwsgws4gs0ko88ocgg00ksg",
    "environment_name": "production",
    "server_uuid": "hgwkwgoswg8o88cg8ko8ocgk",
    "github_app_uuid": "<ObraHaus GitHub App — source_id 3; fetch at execution>",
    "git_repository": "ObraHaus/sparkpoint-pivot",
    "git_branch": "main",
    "build_pack": "nixpacks",
    "base_directory": "/apps/web",
    "ports_exposes": "3000",
    "name": "sparkpoint-web-primary",
    "instant_deploy": false
  }'
# secondary: same body with name=sparkpoint-web-secondary, server_uuid=koww4w8ok84g48s0o0ow4g8s
```

### 2. Environment variables on BOTH apps (BUILD env) — **[me]**/**[operator]**
The gate is read by Edge middleware **at build time**, so set on **primary AND secondary** (a mismatch = one replica serves the full app):
```
SITE_LOCKED=true
NEXT_PUBLIC_SITE_LOCKED=true
NIXPACKS_NODE_VERSION=22
# COOLIFY_URL auto-derived from each app's FQDN
```

### 3. Domains — **[operator]**
- Each app needs an **`http://`** FQDN or Nixpacks fails to build (`COOLIFY_URL: null`). Give the replicas internal-ish FQDNs (e.g. `http://sparkpoint-web-1.obrahaus-develop.aldrickb.xyz`, `…-web-2…`); the **public** domain lives on the **LB**.
- **[operator]** Add the public subdomain + the two replica subdomains to **Cloudflare DNS** and the **nginx reverse proxy**. `http://` scheme only — `https://` causes an infinite 302 loop (TLS terminates upstream).

### 4. Create the nginx LB resource — **[me]**/**[operator]**
- Add `sparkpoint-web-lb` as an nginx docker-compose resource on coolify-master with the `ip_hash` upstream above. Assign the **public** `http://` FQDN to it. (Sticky `ip_hash` isn't strictly needed for a static landing, but it matches the topology and is harmless.)

### 5. Deploy + verify — **[me]**
- Deploy primary and secondary; confirm each via the deployment record (`status: finished` — **not** the status badge): `GET /api/v1/deployments/<uuid>` (read token in `/home/hello/project/.claude/.env`).
- Verify **each replica directly**, then the LB:
  ```
  for h in 192.168.31.240:31101 192.168.31.36:31101 <public-fqdn>; do
    curl -s -o /dev/null -w "%{http_code}        $h /\n"            http://$h/
    curl -s -o /dev/null -w "%{http_code} %{redirect_url}  $h /admin\n" http://$h/admin
  done
  ```
  Expect `/` → 200 and `/admin` → 307 `…/coming-soon` on **all three**. Then load the public URL in a browser: Three.js landing renders; Connect CTA → `/coming-soon`.

## Operational notes (for future me)

- **Gate on BOTH replicas, at BUILD time.** The #1 footgun: `SITE_LOCKED` set on primary but not secondary (or set as runtime-only) → that replica serves the full app and `ip_hash` sends ~half of visitors there. Always set it on both, in the **build** env, and verify each replica directly (step 5), not just the LB.
- **Un-gate at launch = both replicas.** Set `SITE_LOCKED=false` + `NEXT_PUBLIC_SITE_LOCKED=false` on **primary and secondary**, redeploy both. Roll the LB last.
- **`http://` only** everywhere (apps + LB). `https://` → infinite redirect loop.
- **No domain = no build** (Nixpacks `COOLIFY_URL: null`) — the replicas need their own FQDNs even though traffic arrives via the LB.
- **pnpm lockfile trap** ([[sparkpoint-pnpm-version-trap]]): Coolify builds with **pnpm 9** (`--frozen-lockfile`); never regenerate `apps/web/pnpm-lock.yaml` with pnpm 11 or the frozen install breaks. This feature added **no deps**, so the lockfile is unchanged — frozen install is safe.
- **Base dir is `apps/web`** (self-contained Next app with its own lockfile; no root workspace).
- **Deployment record, not the badge** — apps on coolify-build can show `unhealthy` while serving fine; trust `status: finished`.
- **Rollback:** redeploy the previous good deployment in Coolify, or `git revert` on `main` (auto-redeploys). Roll both replicas.

## What I will NOT do without explicit per-call approval
- Any Coolify-mutating API call (create app / LB, set env, trigger deploy) — I'll show each call first.
- Anything touching Cloudflare DNS or nginx (operator-owned).
