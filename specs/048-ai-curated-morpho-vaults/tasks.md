# Tasks — 048 AI-curated vaults (Robinhood Chain 4663)

Legend: `[x]` done · `[ ]` not started · **[GATED]** blocked by a live vault on 4663 (Gate 0).

## Phase M0 — Spec Kit (before any implementation) ✅

- [x] **T001** Write `spec.md` with the locked decisions (performance-fee only · 4663 · daily · hybrid · A+C).
- [x] **T002** Write `plan.md` (architecture, sequencing, risks) including the verified “Morpho has 0
      vaults on 4663” dependency.
- [x] **T003** Write `tasks.md` (this file), and keep the operator todo in sync.
- [ ] **T004** Read the plan back to the operator before M2 starts (pending their go — spec only so far).

## Phase M2 — Curator runner + curated store (no vault needed) — ✅ implemented (0038 pending apply)

- [x] **T101** Agent DB migration: `curated_vaults`, `vault_recommendations`, `vault_curation_audit`.
- [x] **T102** Agent public read: `GET /vaults/curated` → `{ pick, alternates, vaults, lastRunAt, source }`
      with the honest empty shape.
- [x] **T103** Agent admin endpoints: list/approve/deny/pin/hide/edit/add-by-address/run-now/
      auto-publish/audit (mirror `admin/tips`); admin writes set `provenance=admin` and win over scans.
- [x] **T104** `runners/src/curator.ts`: daily loop + Morpho source adapter + screening + scoring +
      publish via the S2S admin API; fail-open to the last good record.
- [x] **T105** Scoring/screening units: anomaly guard, asset allowlist, best-pick determinism, no-op run.
- [x] **T106** Fixture-driven verification on 4663 (empty result today → empty state; a fixture vault →
      populated list and pick).
- [ ] **T107** Ops: env wiring in the Coolify “Beta Bots” project, Kuma monitor, logs, runbook note.

## Phase M4 — Admin → Vaults panel — ✅ implemented

- [x] **T201** Admin panel: candidate queue with scores/provenance, approve/deny/pin/hide, metadata edit,
      add-by-address validation, Run-now, auto-publish toggle, audit view.
- [x] **T202** Tests: admin precedence over a scan, audit rows, non-admin 404 (mirrors the other panels).

## Phase M3 — App surfaces (wireframe A+C) + chat — ✅ implemented

- [x] **T301** `/vault` redesign: hero pick + curated table + filters + provenance (“AI pick · last scan”)
      + “new this week”; honest empty state on 4663; keep the existing vault page intact where a vault
      exists (alpha).
- [x] **T302** Chat entry point on the page + “best vault / where to deposit” intent answering from the
      curated record with a `/vault` deep link.
- [x] **T303** Deposit rail: wrapped ⇒ wrapper deposit (performance fee disclosed); unwrapped ⇒ direct
      ERC-4626 with the no-wrapper disclosure.
- [x] **T304** Web unit tests: pick/table/provenance render; empty state; chat answer from the record.
- [x] **T305** Trust Center: wrapper + off-chain-curation + admin-override disclosure.

## Phase Gate 0 — a live vault on 4663

- [ ] **T401** Confirm at least one ERC-4626 vault exists on 4663 (source configured/verified on-chain).
- [ ] **T402** Re-pin the fork proof to a block where that vault is live.

## Phase M1 — Wrapper + performance fee [CLOSED → superseded by spec 049]

- [x] **T501** Review recorded: feature-011 reuse was superseded by the universal beacon fleet + TimelockController under constitution v4.0.0 (spec 049 §W2). See `specs/049-universal-vault-wrapper/spec.md`.
- [ ] **T502** Superseded by **049 T404** — the first wrapper deploy runs through the scoped deploy runner after the timelock executes and the child is allowlisted. Not yet done (awaits the Sep 22 execute + curation approval).
- [x] **T503** Covered by the `SparkPointUniversalVault` Foundry suite (fee-only-above-HWM fuzz, zero on deposit/withdrawal) shipped with #213; fork rehearsal deferred to the operator. Original text: performance fee **only** on gain above the high-water mark; zero on deposit,
      withdrawal, flat or loss; withdraw always open.
- [x] **T504** Closed by **049 T501**: the runner's verified report flips `wrapped`/`wrapper_address` and the rail routes through the wrapper.

## Phase M5 — Hardening

- [ ] **T601** Daily-run alerts + “last run” surfaced; failure runbook.
- [ ] **T602** Disclosure review (curator risk, wrapper fee, off-chain curation) + both changelogs.
- [ ] **T603** PR(s) per phase through the OH Defender gate; promote `develop → main`.

## Side quests (separate PR, shipped with this spec)

- [ ] **S001** Remove “Route via” from `/swap`.
- [ ] **S002** More default tokens in the swap dropdown (verified 4663 tokens only).
- [ ] **S003** Chat swap card prefills amount + tokens from the AI intent; user only confirms.
