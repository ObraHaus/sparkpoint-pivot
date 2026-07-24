# Feature Specification: US5 — Per-Advice Attribution (the credibility loop)

**Feature Branch**: `feature/020-us5-per-advice-attribution`

**Created**: 2026-07-24

**Status**: Draft

**Input**: Continue the Phase-3-deferred US5 item (docs/phase-3-deferred.md row 7): link each acted-on
recommendation to its realized on-chain outcome so users can see whether the AI's past advice
performed. Depends on the 019 execution spine (shipped). Testnet-buildable, vault path.

---

## Context & Framing

SparkPoint is **"provable, not promised"**: *"each strategy recommendation MUST be labeled over time
with its realized PnL"* (constitution III). Today that loop is broken. The AI recommends; the user can
act on a recommendation (019's build → sign chokepoint); the vault accrues yield; the user can see a
**position-level** realized-outcomes ledger (018's `/outcomes`) — but **nothing links a realized
outcome back to the specific recommendation that caused it.** Recommendations are computed and thrown
away (never persisted), the recommendation→action link is severed in the database, and the outcomes
ledger is per-withdrawal with no advice attribution.

This feature closes the loop: it **persists** each recommendation, **links** an acted-on
recommendation to the on-chain action it caused (via the 019 execution record), and **surfaces the
realized + unrealized PnL of that advice over time** — honestly, reconstructable from chain, never
fabricated. This is the "credibility loop" (FR-039/040/041) and it satisfies **SC-010**: *100% of
acted-upon recommendations generate an outcome log entry that is subsequently updated with realized
PnL.*

Non-custody (N1–N5) is unaffected: this is a **pure read/derive surface** — no key, no fund movement,
no chain write; the withdraw/exit path is never touched.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — "Did the AI's advice actually pay off?" (Priority: P1)

A user acted on an AI recommendation a while ago (e.g. "Supply 100 USDC to the Aave Yield Vault").
Now they want to know: did it work? They open the recommendation's outcome and see, in one place, what
it proposed, that they acted on it (with the on-chain transaction as proof), and its **realized +
unrealized PnL to date**, plainly labeled a win, a loss, or still open.

**Why this priority**: This *is* the feature — the credibility loop that lets a user judge the AI's
advice on results, not promises (FR-041, SC-010, constitution III). It is independently valuable: even
with a single acted-on recommendation it delivers the "was the advice good?" answer.

**Independent Test**: Act on a recommendation, deposit, then view that recommendation's outcome and
confirm it shows the linked transaction and a PnL figure that matches the position's on-chain value;
after a withdrawal, confirm the realized PnL is attributed to the recommendation.

**Acceptance Scenarios**:

1. **Given** a recommendation the user acted on (built + signed a deposit for), **When** they view its
   outcome, **Then** they see the recommendation's title/rationale, the on-chain transaction it
   produced (as proof), and its realized + unrealized PnL with a win/loss/open label.
2. **Given** the position accrues yield over time, **When** the user re-opens the outcome, **Then** the
   PnL reflects the **current** on-chain value (it updates on each view — no stale cached number).
3. **Given** the user later withdraws, **When** they view the outcome, **Then** the realized PnL of
   that exit is attributed to the recommendation.

---

### User Story 2 — Every acted-on recommendation is captured and provably linked (Priority: P1)

The moment a user acts on a recommendation, the recommendation is durably recorded and linked to the
on-chain action it produced, so the outcome history is complete — nothing a user acted on is lost, and
each link is provable on-chain (not asserted).

**Why this priority**: SC-010 requires **100%** of acted-upon recommendations to generate an outcome
log entry. That is only possible if the recommendation is persisted and linked at the moment it is
acted on. Without this, US1 has nothing to show. It is the data spine of the loop.

**Independent Test**: Act on a recommendation and confirm a durable recommendation record exists,
marked "acted", carrying an on-chain link to the execution; confirm a recommendation that was only
viewed (never acted on) does **not** generate an outcome entry.

**Acceptance Scenarios**:

1. **Given** a surfaced recommendation, **When** the user builds a transaction for it, **Then** the
   recommendation is persisted (if not already) and linked to that build, and its status becomes
   "acted".
2. **Given** the user signs and the transaction confirms, **When** it is recorded, **Then** the
   recommendation becomes "executed" and carries the explicit, on-chain-anchored link to the execution.
3. **Given** a recommendation that was surfaced but never acted on, **When** outcomes are listed,
   **Then** it produces **no** outcome entry (only executed recommendations do).
4. **Given** the same recommendation is surfaced repeatedly (re-reads), **When** it is persisted,
   **Then** it is **not** duplicated (one durable record per distinct advice).

---

### User Story 3 — Honest attribution, never a fabricated number (Priority: P1)

Attribution is only ever the explicit "you built and signed this from this recommendation" link. When
a user's position is genuinely blended across multiple recommendations (or funded outside any
recommendation), the per-recommendation figure is **honestly labeled** as a share of a shared position
— never presented as a clean, exact split that the accounting cannot support.

**Why this priority**: This is the constitution's core promise (III — provable, not promised). A
credibility loop that fabricates clean per-advice numbers on blended positions would be worse than
none. It is P1 and cross-cutting.

**Independent Test**: With a position funded by two recommendations, confirm each outcome is labeled as
a share of a shared position (not an invented exact split); with a position funded outside any
recommendation, confirm the outcome is honestly unattributed.

**Acceptance Scenarios**:

1. **Given** an acted-on recommendation with an unambiguous 1:1 link to its position, **When** its PnL
   is shown, **Then** it is attributed by the explicit link and every figure is reconstructable from
   chain.
2. **Given** a position blended across multiple recommendations, **When** each outcome is shown,
   **Then** it is labeled as a share of a shared position (honest), not a fabricated exact split.
3. **Given** funds deposited outside any recommendation, **When** outcomes are listed, **Then** those
   flows are shown as honestly unattributed (position-level), not falsely credited to some advice.

---

### User Story 4 — The outcome stays current as the position lives (Priority: P2)

As a position accrues yield, is added to, or is closed, the recommendation's outcome reflects the live
on-chain truth every time it is viewed — realized PnL grows as exits happen, unrealized PnL marks to
the current share price.

**Why this priority**: FR-040 requires the outcome to be *updated over time with realized PnL*. Because
every figure is derived live from chain on each view, the outcome is always current — but this is a
refinement on top of the P1 link + display, so it is P2.

**Independent Test**: View an outcome, cause an on-chain change (a further deposit or a withdrawal),
re-view, and confirm the figures moved to reflect the new on-chain state.

**Acceptance Scenarios**:

1. **Given** an open outcome, **When** the share price rises, **Then** the unrealized PnL on the next
   view reflects the higher mark.
2. **Given** an open outcome, **When** the user withdraws part of the position, **Then** the realized
   PnL increases and the open portion is re-marked.

---

### Edge Cases

- **Incomplete/transferred history**: if the on-chain share history cannot be fully reconstructed
  (e.g. shares were transferred), the outcome degrades to an honest "can't reconcile" state, never a
  guessed number (mirrors 018's reconciliation gate).
- **Acted but not yet confirmed**: a recommendation built + signed but whose transaction is still
  pending shows as "acted — pending", not yet "executed"; it becomes an outcome only on confirmation.
- **Declined / rejected**: a recommendation the user started to act on but declined, or that policy
  rejected, produces **no** outcome (only executed ones do).
- **Chain/index outage**: the surface degrades to stale + honest empty, never a hard error or a
  fabricated row (advisory read).
- **Legacy acted-on actions (pre-020)**: actions taken before recommendations were persisted have no
  recommendation link; they appear as honestly unattributed position-level outcomes.
- **Withdraw is never affected**: nothing here gates, delays, or touches the withdraw/exit path (N2).

---

## Requirements *(mandatory)*

### Functional Requirements

**Persist + link (the spine)**

- **FR-001**: The system MUST durably persist a recommendation the first time a user **acts** on it (at
  minimum), capturing enough of the recommendation to explain it later: its title, rationale, the
  proposed action/asset/amount, and the mandate + policy version it was scored against.
- **FR-002**: The system MUST give each persisted recommendation a durable identifier that travels with
  the proposal to the client and back when the user acts, and MUST NOT create duplicate records when
  the same recommendation is surfaced repeatedly.
- **FR-003**: When a user builds a transaction from a recommendation, the system MUST link the
  resulting on-chain intent/execution to that recommendation (fixing the currently-severed link), and
  MUST record the linkage method as the **explicit** acted-on link. (FR-039)
- **FR-004**: The system MUST track a recommendation's lifecycle — surfaced → acted → executed (and the
  honest terminal states: declined, rejected) — and MUST create an outcome ONLY for an **executed**
  recommendation. (VR-R4)

**Compute the outcome (provable PnL)**

- **FR-005**: For each acted-on (executed) recommendation, the system MUST compute the outcome of the
  action it caused — the entry cost, the realized PnL, the unrealized PnL, and a win/loss/open label —
  **derived live from on-chain data** (indexed flows + on-chain share price), so the figure is always
  current and never a stale cached value. (FR-040)
- **FR-006**: Every figure shown MUST be reconstructable from chain data (deposits, withdrawals, share
  price at block); the system MUST NOT fabricate or estimate a realized figure. Where the history
  cannot be reconciled, it MUST show an honest "can't reconcile" state, not a guess.
- **FR-007**: When a position is genuinely blended across multiple recommendations (or partly funded
  outside any recommendation), the system MUST attribute honestly — as a **share of a shared position**
  — and MUST NOT present a fabricated exact split. (Principle III)

**Surface it (viewable history)**

- **FR-008**: The system MUST expose the outcome for a single recommendation (its snapshot, the on-chain
  transaction it caused as proof, and its PnL). (FR-041)
- **FR-009**: The system MUST surface, in the outcomes history, which recommendation (if any) each
  realized outcome is attributed to, and by which method (explicit link vs. honestly unattributed).
- **FR-010**: The web MUST let a user see whether past recommendations performed — replacing the current
  "position-level — not yet linked to the specific advice" caveat with the real per-advice link where
  one exists, and keeping the honest unattributed label where none exists. (FR-041)

**Non-custody & honesty (cross-cutting)**

- **FR-011**: This feature MUST be pure read/derive — it MUST hold no key, move no funds, and write
  nothing on-chain (N1/N3/N5); persistence is an off-chain index/accelerator only.
- **FR-012**: Nothing in this feature MUST gate, delay, or alter the withdraw/exit path (N2).
- **FR-013**: The deterministic policy layer remains authoritative for what is signable; this feature
  only observes and attributes outcomes — it MUST NOT change what the AI can propose or what the user
  can sign.

### Key Entities *(include if data involved)*

- **Recommendation**: a durable record of a piece of advice the AI gave — its title, rationale,
  citations, proposed protocol/action/params, rank, the mandate + policy version it was scored against,
  the wallet, a lifecycle status (surfaced → acted → executed / declined / rejected), and a durable id.
  The provability anchor for attribution.
- **Recommendation Outcome**: the credibility record linking an executed recommendation → the on-chain
  action it caused (the transaction) → its realized + unrealized PnL over time, with a win/loss/open
  label and the attribution method. Derived live from chain (not a cached PnL); its existence is gated
  on the recommendation being executed.
- **Attribution Method**: how a realized outcome is tied to advice — the **explicit acted-on link**
  (provable, on-chain-anchored) or **honestly unattributed** (position-level, no advice link).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (= SC-010)**: 100% of acted-upon recommendations generate an outcome entry that is
  subsequently updated with realized PnL — verified by acting on a recommendation and confirming a
  durable, linked, PnL-bearing outcome appears and tracks the position over time.
- **SC-002**: Every acted-on recommendation carries an explicit, on-chain-anchored link to the
  transaction it produced (the link is provable, not asserted) — 100% of acted-on recommendations.
- **SC-003**: 100% of PnL figures shown for an outcome are reconstructable from on-chain data; there is
  no fabricated or estimated realized figure — verified by recomputing from chain independently.
- **SC-004**: A recommendation that was surfaced but never acted on generates **no** outcome entry
  (only executed recommendations do) — 100%.
- **SC-005**: A position blended across multiple recommendations is labeled as a share of a shared
  position (honest), and funds deposited outside any recommendation are labeled honestly unattributed —
  never a fabricated exact split — 100% of such cases.
- **SC-006**: The outcome reflects the current on-chain state on each view (no stale cached PnL) —
  verified by an on-chain change moving the figures on re-view.
- **SC-007 (live acceptance)**: On alpha (testnet), a full round-trip — surface a recommendation, act on
  it (deposit), view its outcome (open, with the linked tx), then withdraw and see the realized PnL
  attributed to the recommendation — completes end to end, every figure reconstructable from chain.
- **SC-008**: No regression to the withdraw/exit path or the existing position-level `/outcomes`
  ledger; the direct exit is untouched (N2).

---

## Assumptions

- **Attribution is intent-log (explicit link) only for the MVP.** The data-model also allows a
  heuristic (sender/target/selector/asset/amount/block-window) match for actions taken outside the
  build→sign chokepoint; that heuristic path is **deferred** — actions not taken through the
  recommendation→build link are shown as honestly unattributed, not heuristically guessed.
- **Persist-on-act (not on every read).** A recommendation is durably persisted when it is acted on (or
  deduped-upsert at surface time), so the store holds one record per distinct piece of advice a user
  engaged with, not one per page refresh.
- **Vault path only, on testnet.** The outcome computation targets the launch Aave vault
  (deposit→withdraw), reusing feature 017/018's reconstructable average-cost replay extended to
  per-recommendation (lot) attribution. Direct-Aave / swaps remain out of scope (deferred/mainnet-gated
  elsewhere).
- **The 019 execution spine is the linkage substrate** (intent bundles + executions already persist
  the build→sign→confirm chain and the transaction hash); this feature populates the currently-unused
  recommendation-link and attribution fields and adds the recommendation store on top.
- **Identity is the connected wallet** (server-derived, as today); a recommendation and its outcome are
  scoped to the wallet that received/acted on it.
- **Housekeeping is part of done**: both changelogs, the deferred register, `MIGRATIONS.md`, and the
  as-built docs are updated in the same change.
