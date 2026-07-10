# Deployment — SparkPoint Pivot

How SparkPoint Pivot ships. Platform specifics in [COOLIFY.md](./COOLIFY.md); local dev in [DEVELOPMENT.md](./DEVELOPMENT.md); migration history in [MIGRATIONS.md](./MIGRATIONS.md).

> **Status (updated 2026-07-10).** The **web app (`apps/web`) is DEPLOYED on OH Coolify** in two environments — **develop** (`sparkpoint-web`, live at `http://i4cw0ogsookkkocsw808gwc4.aldrickb.app`) and a **prod / public landing** off `main` (`SITE_LOCKED=true`, landing-only, live at the **client domain `https://sparkpoint.io`** as of 2026-07-10). The web URLs below are **live**; the backend/agent/chain/DB services do not exist yet (their rows remain planned). Full app inventory + UUIDs in [COOLIFY.md](./COOLIFY.md).

> **Client-project note.** SparkPoint Pivot is an **ObraHaus client product**, *not* part of the ObraHaus Apps Ecosystem. It is in the ObraHaus GitHub org for now; ownership may move to the client later. Sanctioned divergences from the playbook: **wallet auth** (Wagmi / WalletConnect / Coinbase Wallet) instead of obrahaus-console SSO; AI called **directly** (Anthropic / OpenAI-compatible API, or a future own gateway) instead of obrahaus-governor; **own brand** (cobalt / gold / coral) instead of the OH Primary design system. The branch flow, PR security gate, and Coolify deploy/verify conventions still apply.

## Environments

| Environment | Public URL | Git branch | Hosting | DB | Auth cookie / session |
|---|---|---|---|---|---|
| **Prod · public landing (live now)** | **https://sparkpoint.io** | `main` | **OH Coolify** — `sparkpoint-web-primary`/`-secondary` + LB `sparkpoint-web-lb`; `SITE_LOCKED=true` (landing-only) | — (no DB yet) | wallet session |
| **Production (final hosting, later)** | `https://sparkpoint.io` (domain already live) | `main` | **Client's own infra** (TBD; the domain stays, hosting may move off OH Coolify) | Postgres + pgvector (client-managed, TBD) | wallet session (SIWE-style); no shared cookie |
| **Develop / staging (live)** | **http://i4cw0ogsookkkocsw808gwc4.aldrickb.app** | `develop` | **OH Coolify** — `sparkpoint-web` (single instance) | Postgres + pgvector on Coolify (planned) | wallet session |
| **Local** | http://localhost:3000 | working branch | Coder workspace | local Postgres+pgvector / Coolify develop DB | wallet session (unset cookie domain) |

- **Current phase:** the **public landing runs on OH Coolify** off `main` (gated `SITE_LOCKED=true`), now served at the **client domain `https://sparkpoint.io`** (pointed at the OH Coolify LB on 2026-07-10; the former Coolify auto-domain `h8cggk088co8k4400sgwcsww.aldrickb.app` is **retired → 404**). Moving the **hosting** to the client's own infra (keeping `sparkpoint.io`) may still follow — **TBD** with the client handoff. Dev/staging uses OH Coolify per the playbook topology.
- **Develop is intentionally gated too (2026-07-10):** the develop app has **no `SITE_LOCKED` set** → fail-closed = landing-only, *by design* while in development — the full app isn't exposed on any environment yet. Flip `SITE_LOCKED=false` + `NEXT_PUBLIC_SITE_LOCKED=false` on `sparkpoint-web` (develop) + redeploy when a shared full-app preview is wanted (see [COOLIFY.md](./COOLIFY.md)).
- All app domains in Coolify use the **`http://` scheme** (TLS is terminated upstream — see COOLIFY.md). New subdomains must exist in Cloudflare DNS + the nginx reverse proxy.

## Planned services

These get created in Coolify when the build starts (see COOLIFY.md for ports/inventory) — **none are deployed yet**:

- **Web app** (Next.js App Router) — primary + secondary behind the nginx load balancer.
- **Agent service** (OpenClaw / Hermes, self-hosted Docker) — Claude reasoning behind the deterministic policy layer.
- **Postgres + pgvector** — single instance (no LB).
- _Smart contracts (Foundry, Base — ERC-4337 + ERC-4626) deploy to **Base**, not Coolify; chain deploys are a separate runbook authored at build time._

## How deploys happen

Self-hosted **Coolify** (Nixpacks) for dev/staging. **Auto-deploy on push**: `develop` → develop apps. Production deploys go to the **client's infra** (mechanism TBD; document here once the client handoff is scoped — could be Coolify on client infra, the client's own CI, or another platform).

- ⚠️ Merging to `main` is intended to trigger production — **apply DB migrations to prod BEFORE merging** (see MIGRATIONS.md).
- 🚫 **No production deploys on Fridays** (PH / Asia-Manila). Production deploys are **batched** on a deliberate, non-Friday date — not automatically the same day a PR merges.

> **Construction gate (current phase).** The first public deploy is **landing-only**: the `main` build runs with `SITE_LOCKED=true`, so only the marketing landing (`/`) is reachable and every other route redirects to a `noindex` `/coming-soon` page. `develop` runs `SITE_LOCKED=false` (full app) for team/client preview — same artifact, config-only difference (see [COOLIFY.md](./COOLIFY.md) → "Construction gate"). **Launch (un-gate):** set `SITE_LOCKED=false` **and** `NEXT_PUBLIC_SITE_LOCKED=false` on the public app and redeploy — no code change, no revert. The gate is **fail-closed** (unset ⇒ locked), so never rely on omitting the var to open the site. Spec Kit feature `specs/003-landing-only-gate/`.

## Branch flow & PR gates

```
feature/* ──PR──▶ develop ──(batched, non-Friday)──▶ main (prod)
```

Every PR must pass the **OH Defender** security scan before merge (SCA / secrets / SAST; replaces CodeRabbit + Snyk). Check its Check Run gate:
```bash
gh pr checks <PR> -R ObraHaus/sparkpoint-pivot --json name,bucket \
  | jq -e 'all(.[] | select(.name|test("defender";"i")); .bucket=="pass")' && echo "OH Defender gate: PASS"
```
Resolve any findings in the Defender console / via its MCP server before merging. (Until this repo is wired to Defender, legacy CodeRabbit + Snyk checks remain in force.)

> **Smart-contract gates (planned).** When contracts land, PRs touching `contracts/` should additionally be green on `forge test`, gas snapshots, and Tenderly simulation, and follow the non-custody invariant checks from the constitution (N1–N5). Audited contract addresses are recorded in the release notes when deployed to Base.

## Release procedure (production) — planned

1. `develop` is green and deployed; smoke-check the develop URL.
2. **(If DB)** apply migrations to prod; record in [MIGRATIONS.md](./MIGRATIONS.md).
3. **(If contracts)** deploy/verify on Base; record addresses + the Tenderly/Etherscan verification in the release notes.
4. Open PR `develop → main`; wait for the OH Defender scan (Check Run green).
5. **Merge** (non-Friday, batched).
6. Deploy to the **client's production infra** (mechanism TBD — fill in once the handoff is scoped).
7. **Verify** — on Coolify-hosted prod, via the deployment record (`status: finished`, see COOLIFY.md); on client infra, via the client's deploy record + a prod smoke-check.
8. Tag `vX.Y.Z` on the merge commit + publish a GitHub Release from [CHANGELOG.md](./CHANGELOG.md).

## Rollback

- **Coolify (dev/staging):** no rollback API — `git revert` the offending commit and push (Coolify redeploys), or redeploy a previous known-good deployment in the Coolify dashboard.
- **Client production (TBD):** rollback follows the client infra's mechanism; document it here when known. For smart contracts there is **no rollback** — contracts are immutable; mitigate via the **pause-only kill-switch** (constitution N5: pause new deployments, never block user withdrawals) and ship a corrected contract.
