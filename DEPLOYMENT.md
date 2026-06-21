# Deployment — SparkPoint Pivot

How SparkPoint Pivot ships. Platform specifics in [COOLIFY.md](./COOLIFY.md); local dev in [DEVELOPMENT.md](./DEVELOPMENT.md); migration history in [MIGRATIONS.md](./MIGRATIONS.md).

> **Pre-build status.** No application code exists yet (build stage ⑤ has not started). **Nothing below is deployed** — environments, URLs, and services are **planned**. Treat every URL/port as a proposal until the build begins and the apps are actually created.

> **Client-project note.** SparkPoint Pivot is an **ObraHaus client product**, *not* part of the ObraHaus Apps Ecosystem. It is in the ObraHaus GitHub org for now; ownership may move to the client later. Sanctioned divergences from the playbook: **wallet auth** (Wagmi / WalletConnect / Coinbase Wallet) instead of obrahaus-console SSO; AI called **directly** (Anthropic / OpenAI-compatible API, or a future own gateway) instead of obrahaus-governor; **own brand** (cobalt / gold / coral) instead of the OH Primary design system. The branch flow, PR security gate, and Coolify deploy/verify conventions still apply.

## Environments

| Environment | Public URL | Git branch | Hosting | DB | Auth cookie / session |
|---|---|---|---|---|---|
| **Production** | _client infra — TBD (likely https://sparkpoint.io)_ | `main` | **Client's own infra/domain** (TBD; planned later) | Postgres + pgvector (client-managed, TBD) | wallet session (SIWE-style); no shared cookie |
| **Develop / staging** | _planned — http://sparkpoint.obrahaus-develop.aldrickb.xyz_ | `develop` | **OH Coolify** (Proxmox homelab) | Postgres + pgvector on Coolify (single instance) | wallet session |
| **Local** | http://localhost:3000 | working branch | Coder workspace | local Postgres+pgvector / Coolify develop DB | wallet session (unset cookie domain) |

- **Production is on the client's infra, not OH Coolify.** Dev/staging uses OH Coolify per the playbook topology; the production target is the client's own infra/domain (likely `sparkpoint.io`) and is **TBD** until the build progresses and the client handoff is scoped.
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
