# Implementation Plan — 048 AI-curated vaults (Robinhood Chain 4663)

**Spec**: `specs/048-ai-curated-morpho-vaults/spec.md` · **Decisions**: performance-fee only · 4663
locked · daily · hybrid · wireframe A+C.

## ⚠️ Gate 0 — the vault source must exist on 4663

Morpho's API reports **0 vaults on 4663** today. Plan:

1. Discovery is **chain-configured** (`CURATOR_CHAIN_ID=4663`) and source-configured; when a vault
   source lands on 4663 (Morpho or equivalent), the bot finds it with no code change.
2. Until then, everything below that does not need a live vault (M2–M4) can be built and verified,
   and the surfaces show the honest empty state (FR-008).
3. **M1 (wrapper) does not start until a live vault exists** to wrap and fork-test against.

## Architecture

### 1 · Curator runner (off-chain, no keys with value)

- New runner service `runners/src/curator.ts` (same image/pattern as keeper/sweeper; no wallet).
- Daily loop (`CURATOR_INTERVAL_SEC`, default 86400) → **source adapter** → **screen + score** →
  **publish** to the agent.
- Source adapter v1: Morpho GraphQL (`vaults { address asset state { totalAssetsUsd netApy
  curators } }`), chain-filtered. Screening: asset allowlist (USDC first), minimum withdrawable
  liquidity, curator verification where available, listed flag, age, anomaly guard (reject absurd
  APY/liquidity outliers).
- Scoring inputs stored verbatim so every pick has a “why”.
- Publish path: the agent’s admin API with the S2S service token (audit-logged), never direct DB.
- Failure is loud and non-destructive: no write ⇒ last good list stays.

### 2 · Agent (curated store + reads + chat)

- Tables: `curated_vaults` (chain, address, metadata, score, provenance `ai|admin`, status
  `candidate|approved|hidden`), `vault_recommendations` (daily pick + alternates + reasons +
  `as_of`), `vault_curation_audit`.
- Endpoints: public `GET /vaults/curated` (list + pick + last-run timestamp);
  admin `GET/POST /admin/vaults/curation*` (review, approve/deny, pin, hide, edit, run-now,
  auto-publish toggle, audit) — mirrors `admin/tips`/`admin/access` patterns.
- Admin edits are authoritative: writes set `provenance=admin` and the ingest never overwrites them.
- Chat: a coordinator intent (“best vault / where to deposit”) answers from the stored pick and
  deep-links `/vault`; the knowledge seed documents the model and its limits.

### 3 · Web (`/vault`, admin panel) — wireframe A+C

- **A**: hero “Sparky's pick today” (vault, net APY, reason, TVL, curator, “Deposit”), then the
  curated table with filters and provenance (`AI pick · last scan hh:mm`), plus “new this week”.
- **C**: a chat entry point on the page (“Ask Sparky about vaults”) that opens the assistant with the
  question prefilled; answers deep-link back to the table.
- Deposit path: if the book/DB marks the vault **wrapped**, route to the wrapper deposit (performance
  fee disclosed); otherwise direct ERC-4626 deposit with a prominent “no SparkPoint wrapper” note.
- Honest empty state when the curated list is empty (4663 today).
- **Admin → Vaults**: candidate queue with scores, approve/deny/pin/hide/edit, add-by-address,
  Run-now, auto-publish toggle, audit panel; per-row provenance chips.

### 4 · Contracts (M1, hybrid — gated on a live vault)

- **Reuse the existing factory pattern (feature 011): `SparkPointVaultFactory` deploys an immutable
  `SparkPointMorphoVault` wrapper bound to one external vault.** No new custody-critical Solidity
  unless review demands it; the existing wrapper already implements performance fee + high-water mark
  and the always-open withdraw invariant.
- Wrapper deploys are **deliberate and operator-signed** (the AI proposes a wrapper candidate; an
  admin deploys). Curation itself stays gasless; only the deposit rail is on-chain.
- A curated vault with no wrapper is still depositable **directly** (no fee) — the hybrid fallback.

## Sequencing

1. **M0** — this spec + plan + tasks; decisions recorded. *(done when committed)*
2. **M2** — curator runner + agent store/endpoints (no vault needed; verify with a fixture).
3. **M4** — Admin → Vaults panel.
4. **M3** — `/vault` A+C surfaces + chat answers (empty state now; populated when M2 has data).
5. **Gate 0** — a vault source appears on 4663.
6. **M1** — wrapper deployment + fork test against the live vault; flip the deposit rail to wrapped.
7. **M5** — hardening: monitoring, runbook, disclosure review, changelogs.

## Risks

- **Morpho may never deploy to 4663.** Then the curated list stays empty; the system is still correct
  and honest, and D2 can be revisited (Base mainnet is only deferred, not rejected).
- **Wrapper factory reuse needs a review** against constitution v3.0.0 (“configure Morpho's contracts
  instead of writing custody Solidity”). Reuse of the existing, reviewed wrapper is the least-new
  code; if review rejects it, fall back to direct deposits (no fee) until a sanctioned rail exists.
- **Daily automation must never look idle-broken**: last-run timestamp + Kuma monitor + admin Run-now.
