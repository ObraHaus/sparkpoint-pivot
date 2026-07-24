# Implementation Plan: US5 — Per-Advice Attribution (the credibility loop)

**Branch**: `feature/020-us5-per-advice-attribution` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-us5-per-advice-attribution/spec.md`

## Summary

Close the credibility loop: persist recommendations, link an acted-on recommendation to the on-chain
action it caused (through the 019 execution spine), and surface the realized + unrealized PnL of that
advice over time — honestly, reconstructable from chain, never fabricated (FR-039/040/041, SC-010). It
fixes the three dead links found in the map: (1) no `recommendations` table (recs are ephemeral), (2)
`intent_bundles.recommendation_id` is hardcoded `None`, (3) the `/outcomes` ledger is per-withdrawal
with no rec link. New: a `recommendations` store (`0022` migration), a rec-resolve-and-link at
`/build-tx` + a status advance at submit/confirm, a **per-deposit-lot (FIFO) attribution** extension of
017/018's replay, a `GET /outcomes/{recId}` detail + a `recommendations[]` section on `GET /outcomes`,
and a web "by recommendation" surface. **Pure read/derive** — no key, no fund move, no chain write; the
withdraw/exit path is untouched (N1–N5).

## Technical Context

**Language/Version**: Python 3.12 (agent, FastAPI); TypeScript 5 / Next.js 16 (web).
**Primary Dependencies**: agent — FastAPI, asyncpg, the existing `vault_flows` replay (017/018), the
019 `intent_bundles`/`executions` stores, `policy`. web — the existing outcomes surface
(`outcomesView.ts`, `useOutcomes`), the typed `AgentClient`, the catch-all BFF.
**Storage**: Postgres. New: `recommendations` (+ an enum) in `0022_recommendations.sql`. The
`intent_bundles.recommendation_id` + `executions.attribution_method` columns already exist (0021) — this
feature populates them. **No `outcome_logs` table** — outcomes are computed live from chain (018's
established, always-current pattern).
**Testing**: agent — pytest (contract tests + a pure lot-attribution replay unit test), `ruff` +
`mypy --strict`. web — `node --experimental-strip-types --test`, `tsc`, `typecheck:test`, eslint,
`next build`.
**Target Platform**: Linux server (agent) + browsers (web); Base Sepolia (84532) launch vault.
**Project Type**: Web (Next.js + FastAPI) + Postgres.
**Performance Goals**: no new hot-path load; the outcome compute reuses the same indexed-flows read the
portfolio already does, extended to per-lot.
**Constraints**: pure read/derive (N1/N3/N5); N2 exit never touched; every figure reconstructable from
chain (no fabricated/estimated realized PnL); honest labeling for blended positions.
**Scale/Scope**: closed alpha; the deployer wallet + a few beta users. One end-to-end round-trip on
Base Sepolia (SC-007) is the bar.

## Constitution Check

*GATE: Must pass before Phase 0. Re-checked after Phase 1 (below).*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Non-custodial (N1–N5)** | no keys, exit never gated, provable | **PASS by construction.** Pure read/derive: it persists an off-chain rec index and *reads* the 019 execution records + the indexed flows to attribute PnL. It holds no key, moves no funds, writes nothing on-chain (N1/N3/N5), and never gates/touches the withdraw path (N2 — the `/exit` path and `/outcomes` reconciliation are unchanged). |
| **II. AI proposes, deterministic policy disposes** | policy authoritative | **PASS.** This only *observes + attributes* outcomes after the fact; it does not change what the AI can propose or what the deterministic policy makes signable. The rec store records what was proposed; the 019 policy gate is untouched. |
| **III. Provable, not promised** | real reads or honest state, never faked; recs labeled over time with realized PnL | **PASS — this feature IS Principle III.** Every PnL figure is reconstructed live from chain (indexed flows + on-chain share price), gated on reconciliation (else honest "can't reconcile"); attribution is the explicit on-chain-anchored build→sign link only; a blended position is labeled as a *share of a shared position*, never a fabricated exact split. It delivers the constitution's "each recommendation labeled over time with its realized PnL." |
| **IV. Bounded blast radius** | contained | **PASS.** No new contract surface, no new signable path. The worst case of a rec-store outage is a degraded/empty attribution view (fail-open) — never a trapped fund or a blocked exit. |
| **V. Conservative launch** | vault single-purpose | **PASS.** Vault path only; no new strategy, no fee change. |
| **VI. Spec-driven** | spec→plan→tasks | **PASS.** |
| **VII. Simplicity/YAGNI** | narrow milestone | **PASS (one justified narrowing).** Attribution is **intent-log only**; the heuristic-match path (data-model VR-O3) + non-vault actions + a persisted `outcome_logs` table are **deferred**. Outcomes stay computed-live (no cron/worker), matching 018. |

**No violations.** The one narrowing (intent-log-only, live-compute) is a *reduction*, recorded in
research.md R1/R5.

## Project Structure

### Documentation (this feature)

```text
specs/020-us5-per-advice-attribution/
├── plan.md · spec.md · research.md · data-model.md · quickstart.md
├── contracts/outcomes-attribution.md
└── checklists/requirements.md
```

### Source Code

```text
services/agent/src/sparkpoint_agent/
├── db/recommendations.py            # NEW store: upsert-by-dedupe, get, mark_acted, mark_executed
├── db/__init__.py                   # export the store
├── migrations/0022_recommendations.sql  # NEW: recommendations table + recommendation_status enum
├── api/recommendations.py           # persist (upsert) each surfaced rec; recId -> the persisted UUID; GET /{recId} = store read
├── execution/orchestrate.py         # build_tx: resolve-or-create the rec, WRITE intent_bundles.recommendation_id + wire recId; submit/status: mark executed + executions.attribution_method='intent_log'
├── db/executions.py                 # add attribution_method write to update_status / a setter
├── db/vault_flows.py                # NEW replay_lots(): per-deposit FIFO lot attribution (realized+unrealized per lot, keyed by deposit tx)
├── api/portfolio.py                 # /outcomes gains a recommendations[] section; NEW GET /outcomes/{recId}
└── (chain/vault_reader used for the current share price mark)

apps/web/src/
├── lib/agent/outcomesView.ts        # extend the DTO/view with the per-rec attribution rows
├── lib/agent/useAgent.ts            # (useOutcomes already fetches /outcomes; add the rec section)
└── app/(app)/outcomes/page.tsx      # a "By recommendation" section; retire the "not linked to advice" caveat where a link exists
```

**Structure Decision**: Reuse the 018 `/outcomes` home (`api/portfolio.py`) + the 017/018 replay
(`db/vault_flows.py`), extended to per-lot. Persistence lives in a new `db/recommendations.py` mirroring
the 021 store idioms. The linkage happens in the already-built 019 `execution/orchestrate.py`.

## Implementation Design (the concrete wiring)

### 1. Persist recommendations (`0022` + `db/recommendations.py` + `api/recommendations.py`)

- **Table `recommendations`** (0022): `id UUID PK`, `wallet CITEXT`, `dedupe_key TEXT` (UNIQUE — see
  below), `strategy_kind TEXT`, `title TEXT`, `rationale TEXT`, `proposed_action JSONB`, `rank SMALLINT`,
  `mandate_version TEXT NULL`, `policy_version TEXT`, `status recommendation_status NOT NULL DEFAULT
  'surfaced'`, `created_at/updated_at`. Enum `recommendation_status` = `surfaced|acted|executed|declined|
  rejected`. Idempotency: `UNIQUE(dedupe_key)` where `dedupe_key = sha256(wallet|strategy_kind|
  canonical(proposed_action)|policy_version)` — so re-surfacing the same advice upserts one row (FR-002).
- **`api/recommendations.py`**: at surface time, upsert each cleared rec (full snapshot) and set the
  wire `recId` = the persisted UUID (replacing `rec_{strategy_kind}`). `GET /recommendations/{recId}`
  becomes a store read (a UUID no longer matches the old strategy-keyed recompute). Advisory/fail-open:
  a store outage degrades to the old ephemeral behavior (never blocks the list).

### 2. Link the acted-on rec (`execution/orchestrate.py` — the 019 spine)

- `build_tx`: when `req.action.recommendationId` is present, **resolve-or-create** the persisted rec
  (get by UUID; else create a MINIMAL rec from the action — covers chat/legacy ids without touching the
  chat SSE path), write `intent_bundles.recommendation_id = <persisted UUID>` (fixing the hardcoded
  `None` at orchestrate.py:137), set the wire `IntentBundle.recommendationId = <persisted UUID>`, and
  mark the rec `acted`. Unknown/absent id → unlinked (honest, unattributed).
- `submit_signed` / `submission_status` (confirm): mark the rec `executed` and write
  `executions.attribution_method = 'intent_log'` + `intent_log_action_id` (null for eoa; the tx is the
  anchor). This is the explicit provable link — no heuristic.

### 3. Per-deposit-lot outcome (`db/vault_flows.py` `replay_lots` + `api/portfolio.py`)

- **`replay_lots(flows, current_shares, current_pps)`**: extend the average-cost replay to FIFO **lots**.
  Each deposit is a lot `{tx, block, cost, shares_remaining}`; each withdrawal consumes lots FIFO,
  realizing `assets_out − Σ(lot cost consumed)` per lot; a lot's **unrealized** = `shares_remaining ×
  current_pps − remaining_cost`. Returns per-lot `{deposit_tx, entry_cost, realized, unrealized,
  shares_remaining, label}` + the same reconciliation gate as `replay_outcomes`. Exact integer math,
  reconstructable. (FIFO is the standard, defensible lot method; it never fabricates a split.)
- **`GET /outcomes/{recId}`**: rec → its linked execution (`executions` by `recommendation_id` via
  `intent_bundles`) → the deposit tx → the matching lot from `replay_lots` → return `{recommendation
  snapshot, actedTx, entryUsd, realizedUsd, unrealizedUsd, label, attributionMethod:'intent_log',
  reconstructable}`. `NOT_FOUND` for an unknown/unexecuted rec.
- **`GET /outcomes`**: add a `recommendations[]` section — one row per acted-on (executed) rec with its
  lot outcome + `attributionMethod`; the existing per-withdrawal `outcomes[]` stays (position-level).
  Honesty: if a rec's deposit lot is one of several (blended), the row is labeled a share of a shared
  position (the lot is still its own honest slice); deposits with no rec link are position-level
  (unattributed).

### 4. Web surface (`outcomesView.ts` + `outcomes/page.tsx`)

- Extend the outcomes DTO/view with the `recommendations[]` rows; render a **"By recommendation"**
  section — each acted-on rec: its title, the acted tx (proof link), realized + unrealized PnL, and a
  win/loss/open label. Retire the "position-level — not yet linked to the specific advice" caveat where
  a real link exists; keep it (honestly) for unattributed position-level flows. Pure display; no signing.

### What we DON'T build (scope guard)

The heuristic-match attribution path (data-model VR-O3 — sender/target/selector/asset/amount/block-window
for non-chokepoint actions); a persisted `outcome_logs` table + a background PnL worker (we compute
live, always-current, per 018); chat-SSE-path full-snapshot persistence (chat-acted recs get the
build-time minimal snapshot); non-vault (direct-Aave / swap) outcomes.

## Post-Design Constitution Re-Check

Re-evaluated after the design: **still PASS.** Pure read/derive; no key/fund/chain-write; N2 exit
untouched; every figure chain-reconstructable with an honest reconcile gate; attribution is the explicit
link with honest labeling for blended/unattributed. The narrowing (intent-log-only + live-compute)
reduces surface. Proceeding to `/speckit-tasks`.

## Phases

- **Phase 0 — research.md**: the 6 design decisions (persist-on-surface+resolve-at-build, dedupe key,
  recId→UUID ripple, FIFO lot attribution, live-compute vs outcome_logs table, honest blended labeling).
- **Phase 1 — data-model.md + contracts/ + quickstart.md**: the `recommendations` table + the outcome
  wire shapes + the end-to-end validation guide.
- **Phase 2 — tasks.md** (`/speckit-tasks`).
