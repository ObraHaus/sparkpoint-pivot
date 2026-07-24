# Phase 0 — Research & Design Decisions: US5 per-advice attribution

Grounded in a 5-subsystem ground-truth map (the /outcomes internals, recommendations flow, the
data-model E7/E13, the §3.8 contract + FR-039/040/041/SC-010, and the 019 linkage state). No NEEDS
CLARIFICATION remain.

---

### R1 — Attribution is INTENT-LOG (explicit acted-on link) only; heuristic deferred

- **Decision**: attribute an outcome to a recommendation ONLY via the explicit
  recommendation → intent_bundle → execution link created when the user builds + signs through the 019
  chokepoint. The data-model's heuristic-match path (VR-O3: sender/target/selector/asset/amount/
  block-window) for actions taken *outside* the chokepoint is deferred.
- **Rationale**: the intent-log link is on-chain-anchored + unambiguous (Principle III). A heuristic
  guess risks mis-crediting advice; better to show non-chokepoint actions as honestly *unattributed*
  than to fabricate a link. The 019 chokepoint already records the link substrate.
- **Alternatives rejected**: build the heuristic now — more surface + a real risk of a wrong attribution;
  out of scope for the honest MVP.

### R2 — Persist recommendations on surface (upsert) + resolve-or-create at build

- **Decision**: persist a full rec snapshot at surface time in `GET /recommendations` (upsert by a
  content `dedupe_key`), returning `recId` = the persisted UUID. At `/build-tx`, resolve the
  recommendationId to that persisted rec; if it does not resolve (a chat ephemeral id / legacy tag),
  **create a minimal rec** from the action so the acted-on rec is still logged + linked (SC-010).
- **Rationale**: recs are stateless today (no table). Persist-on-surface captures the rationale/title
  (needed for the outcome detail, FR-008); resolve-or-create-at-build guarantees 100% of *acted-on*
  recs are logged (SC-010) WITHOUT touching the complex chat SSE path (chat-acted recs get the
  build-time minimal snapshot — honest: the link + PnL are present, the rationale is absent).
- **Alternatives rejected**: persist only at build (loses the rationale for the REST surface); persist
  in the chat SSE/DAG path too (higher risk — deferred as an enhancement).

### R3 — `dedupe_key` = a content hash → one row per distinct advice (FR-002)

- **Decision**: `dedupe_key = sha256(lower(wallet) | strategy_kind | canonical_json(proposed_action) |
  policy_version)`, `UNIQUE`. Upsert via `INSERT … ON CONFLICT (dedupe_key) DO UPDATE` (refresh
  title/rationale/updated_at, keep id + status).
- **Rationale**: `GET /recommendations` is called on every page load; a naive insert-per-read would
  duplicate. A content dedupe key makes re-surfacing idempotent (one durable record per distinct advice),
  and preserves the id + lifecycle across re-reads. Canonical JSON (sorted keys) makes the hash stable.
- **Alternatives rejected**: a random id per read (duplicates); no persistence on read (loses snapshot).

### R4 — recId becomes a UUID; the detail endpoint becomes a store read

- **Decision**: the wire `recId` (and `proposedAction.recommendationId`) is now the persisted UUID (was
  `rec_{strategy_kind}`). `GET /recommendations/{recId}` reads the store by UUID (the old
  recompute-by-strategy-kind can't match a UUID). `intent_bundles.recommendation_id` (a UUID column,
  already in 0021) now holds the resolved UUID; the wire `IntentBundle.recommendationId` echoes the
  resolved UUID so the client can look the outcome up by it.
- **Rationale**: the 0021 column is UUID; a `rec_`-prefixed string can't be stored there. Making recId a
  UUID resolves the type mismatch the map flagged and is transparent to the web (it just passes the
  string). Fail-open: if the store is down, `/recommendations` falls back to the ephemeral id (advisory).
- **Alternatives rejected**: keep the string recId + a separate UUID (a two-id-space split that
  complicates the outcome lookup).

### R5 — Compute outcomes LIVE (no `outcome_logs` table, no worker)

- **Decision**: compute each rec's outcome on-the-fly from the indexed flows + the on-chain share price
  on every read (extend 017/018's replay), exactly as 018's `/outcomes` does. Do NOT migrate the E13
  `outcome_logs` table or run a background PnL worker.
- **Rationale**: 018 already established live-compute as the honest, always-current, reconstructable
  pattern (no cached PnL that goes stale — FR-040's "updated over time" is satisfied by live recompute).
  A persisted outcome_logs + a cron worker adds staleness + infra for no honesty gain at alpha scale.
- **Alternatives rejected**: persist outcome_logs + a marker worker (the data-model's fuller design) —
  deferred; live-compute is simpler + strictly more honest.

### R6 — Per-deposit FIFO lot attribution; honest labeling for blended positions

- **Decision**: extend the replay to **per-deposit lots** (`replay_lots`). Each deposit is a lot
  `{tx, block, cost, shares}`; withdrawals consume lots FIFO, realizing `assets_out − Σ(lot cost)` per
  lot; a lot's unrealized = `shares_remaining × current_pps − remaining_cost`. A rec's outcome = the lot
  of its linked deposit tx. When a position is blended (multiple lots / some unattributed), each rec's
  row is honestly labeled a *share of a shared position*; deposits with no rec link stay position-level.
- **Rationale**: average-cost pooling (018) can't split a withdrawal across the recs that funded a
  position. FIFO lots are the standard, deterministic, chain-reconstructable method that gives each rec's
  deposit its own honest realized+unrealized slice — no fabricated exact split (FR-007, SC-005). The
  lot is keyed by the deposit tx (the explicit link), so it is provable.
- **Alternatives rejected**: pro-rata split of a blended withdrawal (an invented number); average-cost
  only (no per-rec resolution).

---

**All unknowns resolved.** Proceed to Phase 1.
