# Deploy Runbook — gated public landing (feature 003)

Stand-up of the **landing-only public deployment** off `main`, in the **primary + secondary + nginx LB** topology (playbook §5). The code is on `main` (gate included). Living references: [COOLIFY.md](../../COOLIFY.md), [DEPLOYMENT.md](../../DEPLOYMENT.md).

> ## ✅ DEPLOYED & VERIFIED — 2026-06-26
> **Public URL:** **<internal-host>** — gated (`/` → 200 landing; every other route → 307 `/coming-soon`; RSC/`.rsc`/prefetch → 307 `noindex`, no flight leak; LB distributing across both replicas). Un-gate at launch = flip `SITE_LOCKED=false` on both replicas (see end).

## As-built topology

| Resource | Kind | Server | uuid | Host:container / domain | Gate |
|---|---|---|---|---|---|
| `sparkpoint-web-primary` | application | <coolify-server-a> (`<internal-ip>`) | `<coolify-uuid>` | `<host-port>:<container-port>` · **no domain** | `SITE_LOCKED=true` |
| `sparkpoint-web-secondary` | application | <coolify-server-b> (`<internal-ip>`) | `<coolify-uuid>` | `<host-port>:<container-port>` · **no domain** | `SITE_LOCKED=true` |
| `sparkpoint-web-lb` | service (nginx) | <coolify-server-a> | `<coolify-uuid>` | **`<internal-host>`** → `ip_hash` upstream of both `:<host-port>` | — |

Both replicas run the **same gated build** on different servers, sharing host port `<host-port>`; the nginx LB owns the public domain and round-robins (`ip_hash`) to both. The replicas have **no domain of their own** — they are reached only via the host port through the LB.

## Live Coolify IDs

| Thing | Value |
|---|---|
| Project | **SparkPoint Pivot Project** = `<coolify-uuid>` |
| Environment | **`production`** = `<coolify-uuid>` (others: `develop` `<coolify-uuid>`, `preview` `<coolify-uuid>`) |
| Server — <coolify-server-a> | `<coolify-uuid>` (`localhost`/`host.docker.internal`; LAN `<internal-ip>`; server_id 0) |
| Server — <coolify-server-b> | `<coolify-uuid>` (`<internal-ip>`; server_id 1) |
| Git source | ObraHaus GitHub App `<coolify-uuid>` (`source_id: 3`) → `ObraHaus/sparkpoint-pivot` |
| Auto-domain wildcard | `*.<internal-host>` is the Coolify-generated domain wildcard on <coolify-server-a> |

## Procedure (what was done — reusable)

### 1. Create the two app resources (API)
Two `private-github-app` applications in **production**, identical except name + server:
```bash
curl -X POST "$BASE/api/v1/applications/private-github-app" -H "Authorization: Bearer $RWD" -H "Content-Type: application/json" -d '{
  "project_uuid":"<coolify-uuid>", "environment_name":"production",
  "server_uuid":"<coolify-uuid>",  "github_app_uuid":"<coolify-uuid>",
  "git_repository":"ObraHaus/sparkpoint-pivot", "git_branch":"main",
  "build_pack":"nixpacks", "base_directory":"/apps/web", "ports_exposes":"3000",
  "name":"sparkpoint-web-primary", "instant_deploy":false }'
# secondary: name=sparkpoint-web-secondary, server_uuid=<coolify-uuid>
```
Then PATCH each: `{"ports_mappings":"<host-port>:<container-port>","install_command":"pnpm install --frozen-lockfile"}`.

### 2. Env on BOTH apps (build-time)
Field is **`is_buildtime`**, but the create API rejects it — POST `{key,value}` only; Coolify defaults new vars to `is_buildtime:true` + `is_runtime:true` (which is what we need):
```bash
for KV in SITE_LOCKED=true NEXT_PUBLIC_SITE_LOCKED=true NIXPACKS_NODE_VERSION=22; do
  curl -X POST "$BASE/api/v1/applications/$APP/envs" -H "Authorization: Bearer $RWD" \
    -H "Content-Type: application/json" -d "{\"key\":\"${KV%%=*}\",\"value\":\"${KV#*=}\"}"; done
```

### 3. Deploy each app, verify
`GET $BASE/api/v1/deploy?uuid=$APP` → poll `GET $BASE/api/v1/deployments/<deployment_uuid>` until `status:finished`.

### 4. Create the nginx LB (service, API)
`docker_compose_raw` must be **base64**. The Coolify inline `content:` bind-mount **silently fails** when created via the API (Docker mounts an empty dir over the conf → nginx exits) — so write the nginx config via `command` instead:
```yaml
services:
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    environment:
      - SERVICE_FQDN_NGINX_80
    command:
      - /bin/sh
      - -ec
      - |
        cat > /etc/nginx/conf.d/default.conf <<'EOF'
        upstream sparkpoint_web { ip_hash; server <internal-host>:<host-port>; server <internal-host>:<host-port>; }
        server { listen 80; location / {
          proxy_pass http://sparkpoint_web; proxy_http_version 1.1;
          proxy_set_header Host $$host; proxy_set_header X-Real-IP $$remote_addr;
          proxy_set_header X-Forwarded-For $$proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $$scheme;
        } }
        EOF
        exec nginx -g 'daemon off;'
```
```bash
B64=$(base64 -w0 < lb-compose.yml)
curl -X POST "$BASE/api/v1/services" -H "Authorization: Bearer $RWD" -H "Content-Type: application/json" \
  -d "$(jq -n --arg c "$B64" '{name:"sparkpoint-web-lb",project_uuid:"<coolify-uuid>",environment_name:"production",server_uuid:"<coolify-uuid>",docker_compose_raw:$c,instant_deploy:true}')"
```

### 5. Set the LB domain + clear replica domains — **DASHBOARD ONLY**
The Coolify API on this version (`4.0.0-beta.434`) **cannot set a custom domain on a compose service** (it auto-generates `nginx-<service-uuid>.<internal-host>` and ignores `SERVICE_FQDN_*` overrides + the baked-in compose value), and it **rejects an empty app domain** (422). So in the UI:
1. **LB → nginx → Domains** = `<internal-host>` → redeploy.
2. Remove that domain from **`sparkpoint-web-secondary`** first (it held it as its default `<uuid>.<internal-host>`).
3. Remove the staging domain from **`sparkpoint-web-primary`**.

### 6. Verify (final)
```bash
D=<internal-host>
curl -s -o /dev/null -w "%{http_code}  /\n" $D/                 # 200 (landing)
for p in /admin /chat /confirm/x /vault /onboarding /nope; do
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}  $p\n" $D$p; done   # all 307 -> /coming-soon
curl -s -H 'RSC: 1' -D - -o /dev/null $D/admin | grep -i 'x-robots'         # noindex, no flight
```

## Operational notes (for future me)

- **Gate on BOTH replicas, at BUILD time.** `SITE_LOCKED` on primary but not secondary → `ip_hash` sends ~half of visitors to a fully-open app. Verify each replica directly (host port `<host-port>`), not just the LB.
- **Custom service domain = dashboard only.** The API auto-generates `nginx-<uuid>.<internal-host>` for compose services and offers no override (tried: `SERVICE_FQDN_NGINX` env, baking it into the compose, delete+recreate, service PATCH `domains`, inner-app PATCH — all ignored/rejected). Set it in the UI's Domains field.
- **Inline `content:` bind-mount fails via API.** Write the nginx config with `command` (heredoc → `nginx -g 'daemon off;'`); escape nginx vars as `$$host` etc. for compose.
- **`docker_compose_raw` must be base64**; env API field is **`is_buildtime`** (not `is_build_time`).
- **<coolify-server-b> apps aren't reachable by their own FQDN** (the wildcard + nginx point at <coolify-server-a>) — reach/verify them via host port `<host-port>` on `<internal-ip>` or through the LB.
- **`running:unhealthy` badge is a false-negative** on <coolify-server-b> and on the LB service (no healthcheck) — trust the actual HTTP response / `status:finished`.
- **⚠️ Replicas now have NO domain.** A future Nixpacks rebuild can fail with `COOLIFY_URL: null`. If a redeploy breaks, give each replica an **internal** FQDN (e.g. `http://web1.internal`) or set `COOLIFY_URL` explicitly — the public domain stays on the LB only.
- **`http://` scheme** for the in-Coolify domain (TLS terminates upstream; `https://` → redirect loop). External clients use `https://`.
- **pnpm lockfile trap** ([[sparkpoint-pnpm-version-trap]]): Coolify builds with **pnpm 9** `--frozen-lockfile`; never regenerate `apps/web/pnpm-lock.yaml` with pnpm 11. This feature added no deps — safe.
- **Deployment record, not the badge** — `GET /api/v1/deployments/<uuid>` → `status:finished`.

## Launch (un-gate) — when the app is ready
1. Set `SITE_LOCKED=false` + `NEXT_PUBLIC_SITE_LOCKED=false` on **primary AND secondary**, redeploy both.
2. Verify the full app loads through the LB domain; roll the LB last.
3. No code change / revert — the gate stays dormant in the codebase.

## Rollback
- Redeploy the previous good deployment in Coolify, or `git revert` on `main` (auto-redeploys). Roll both replicas.
