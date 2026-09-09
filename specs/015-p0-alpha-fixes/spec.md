# Feature Specification: P0 Alpha Fixes — mandate honesty, explainability, fee disclosure, live caps, the confirm gate

**Feature Branch**: `feat/015-p0-alpha-fixes`

**Created**: 2026-07-23

**Status**: Draft

**Input**: The Jul-23 Phase-2 gap audit of alpha.sparkpoint.io found the core MVP live but six small, high-trust surfaces silently degraded: onboarding saves a server-recomputed *default* mandate that drops the user's real answers; the real mandate is never shown in-app; recommendation cards throw away the model's rationale and citations; the vault deposit gate never shows the canonical performance-fee disclosure; the caps meter reads a compile-time mirror instead of the live CapRegistry; and the standalone `/confirm/[intent]` route never runs the real trust gate. Fix all six — frontend-only, no schema/agent/contract change — so the differentiating wedges ("learns your goals", "explains every move", "0% on principal", "provable") are actually delivered on alpha.

## Clarifications

### Session 2026-07-23

Resolved before authoring (locked with the operator's explicit "proceed" for the P0 batch):

- **Q: For the onboarding-save bug, map the web selections to the server's canonical keys, or persist the local draft?** → **A: Persist the LOCAL draft as the source of truth.** The server collapses everything to a 3-value `riskProfile` from `scenario` alone and has no field for the 1..5 slider tier, so a canonical-key mapping still diverges from what the mandate step renders. The local `buildMandateDraft` already computes exactly what is shown; persisting it makes **saved == shown**. The server persist contract stores the posted body verbatim.
- **Q: Does any fix change the agent, the contracts, the DB schema, or a migration?** → **A: No.** All six are pure web (`apps/web`) wiring. `GET /mandate` and `GET /recommendations` (with `citations`) already exist and already proxy through the GET/POST BFF; `CapRegistry` is already deployed with a live-read ABI.
- **Q: Does the accrued-performance-fee receipt line show a dollar figure?** → **A: No.** Pure RPC has no cost basis and `previewRedeem == convertToAssets` (the profit-only fee is taken as share dilution), so the receipt line is an honest disclosure keyed to the live `performanceFeeBps` %, never a fabricated amount — consistent with Principle III.
- **Q: Does making `/confirm/deposit` run the real gate open a beta bypass?** → **A: No.** Deposit stays behind the beta whitelist (mirrors `/vault/deposit`); withdraw is never beta/pause/cap-gated (N2). No usable amount in the URL falls back to the live amount-entry screen, which runs the identical gate on confirm — never a fabricated preview.
- **Q: Is the caps change display-only?** → **A: Yes.** Deposit enforcement already uses the on-chain `maxDeposit`; this only corrects the cap *number* shown to users, with a fail-soft fallback to the versioned policy mirror when the read is unresolved.

## User Scenarios & Testing *(mandatory)*

These six stories each close a specific Phase-2 acceptance gap from spec 001 (US1/US2/US3/US5) and the constitution (Principles III, V). Each is an independently testable, viable slice.

### User Story 1 - Onboarding saves the mandate the user actually chose (Priority: P1)

A user completes onboarding, sees their plan (goal, risk tier, timeline) on the final step, and confirms it. The mandate persisted is the exact one shown — their real goal, their final slider tier, their timeline — not a server-recomputed default. The save is awaited with a clear success/error state.

**Why this priority**: This is the "learns your goals" wedge. Today the saved mandate silently ignores the user's answers (always conservative / grow_savings / 12-month), so every downstream recommendation is ranked against the wrong plan. It's a correctness defect masquerading as a working feature.

**Independent Test**: Complete onboarding choosing "Aggressive growth / 3+ years / tier 5", confirm, then read `GET /mandate` (or Settings → Mandate) and verify the persisted `goals[0].kind = aggressive_growth`, `riskProfile = growth`, `horizonMonths = 48` — not the defaults. Confirm the "Set my plan" button shows "Saving…", advances only on success, and shows a retry on failure.

**Acceptance Scenarios**:

1. **Given** a user who picked a non-default goal/tier/timeline, **When** they confirm their plan, **Then** the `POST /mandate` body reflects those exact selections (goal kind + label, tier-derived `riskProfile` in `{conservative,moderate,growth}`, timeline-derived `horizonMonths` of 6/24/48).
2. **Given** the save is in flight, **When** the user waits, **Then** the confirm button is disabled and reads "Saving…"; on success it advances to the completion step; on failure it stays and offers "Try again".
3. **Given** no connected wallet, **When** the user tries to confirm, **Then** the flow surfaces an error state instead of silently advancing as if saved.
4. **Given** a tier ≥ 4 selection, **When** the mandate is persisted, **Then** `riskProfile` is `growth` (never the server-rejected `aggressive`) so the save never 400s.

---

### User Story 2 - The user can see and confirm their real mandate in-app (Priority: P1)

A user opens Settings → Mandate (and the chat right-rail card, and the portfolio drift row) and sees their real persisted mandate — risk tier, goal, timeline, max slippage — with honest loading / empty / disconnected states, instead of a hardcoded tier-1 mock.

**Why this priority**: A user can never confirm the "learns your goals" promise if the app only ever shows a fake plan. Pairs with US1 so the loop (choose → save → see) is real end-to-end.

**Independent Test**: With a connected, signed-in wallet that has a persisted mandate, open Settings → Mandate and confirm it shows the real profile/goal/timeline/slippage; remove the mandate and confirm it shows "No plan yet" + a setup CTA; disconnect and confirm it shows "Connect your wallet".

**Acceptance Scenarios**:

1. **Given** a persisted mandate, **When** the user opens Settings → Mandate, **Then** the real `riskProfile` (as a tier), primary goal label, timeline (from `horizonMonths`), and max slippage are shown — no literal "Steady USDC yield / 1–3 years".
2. **Given** no persisted mandate, **When** the user opens the mandate surfaces, **Then** an honest "No plan yet" empty state with a link to onboarding is shown.
3. **Given** a disconnected / loading / errored read, **When** the surfaces render, **Then** they show truthful "connect" / "loading" / "couldn't load" states — never mock numbers.
4. **Given** the portfolio risk panel, **When** the user has a mandate and a live position, **Then** "Drift vs your plan" shows "On plan" (realized tier ≤ mandate tier) or "Above your plan" (exceeds it).

---

### User Story 3 - Recommendation cards explain themselves with real rationale + sources (Priority: P1)

A user views strategy recommendations and, per card, sees the model's real plain-language rationale in the "Why this?" expander plus a source chip listing the real Obsidian citations the recommender returned.

**Why this priority**: "Explains every move" and "advisor-grade explainability" are core differentiators. The data already reaches the browser and is silently dropped — this is pure wiring with high credibility payoff.

**Independent Test**: With a mandate + a successful ranking turn, confirm a live rec card shows a "N source(s)" chip and the expander shows the server rationale + up to 3 citation rows (provider · field: value); confirm the mock/offline fallback still shows the curated static copy with no chip.

**Acceptance Scenarios**:

1. **Given** a live rec with citations, **When** the card renders, **Then** a source chip reads "N source(s)" and opening "Why this?" shows the real rationale followed by up to 3 citation rows.
2. **Given** the offline / mock fallback, **When** the card renders, **Then** the existing curated static copy shows and no citation chip appears.
3. **Given** a malformed citation row, **When** it is parsed, **Then** it is dropped safely (no crash, no blank card); `signable` still ⟺ `policy.status === "approved"`.

---

### User Story 4 - The vault deposit gate discloses the fee terms; the receipt discloses accrued fee (Priority: P1)

Before signing a deposit, the user sees the canonical performance-fee disclosure ("10% of yield, profit-only, high-water mark — 0% on your principal…") verbatim plus an explicit "0% management fee" row. After a withdrawal, the receipt discloses the accrued performance-fee terms keyed to the live fee %.

**Why this priority**: Direct spec-001 US1 AC5/AC6 and constitution Principles III & V ("we only earn when you earn", fully disclosed). It is a trust surface shown at the moment of signing.

**Independent Test**: Open the deposit confirm gate (route and chat-inline) and verify the verbatim disclosure string + the "Management fee · 0% — none" row appear; complete a withdrawal and verify the receipt shows "Accrued performance fee: 10% of profit over your high-water mark … 0% to withdraw, 0% on your principal".

**Acceptance Scenarios**:

1. **Given** a prepared deposit, **When** the confirm gate reveals, **Then** the canonical `PERFORMANCE_FEE_DISCLOSURE` renders verbatim (byte-identical to the agent's `_DEPOSIT_DISCLOSURE`) and a "Management fee · 0% — none" row is present.
2. **Given** a completed withdrawal, **When** the receipt shows, **Then** an accrued-performance-fee line keyed to the live `performanceFeeBps` states it is profit-only, over the high-water mark, already reflected in the returned amount, and 0% to exit — with no fabricated dollar figure.
3. **Given** a wrapper vault, **When** the receipt shows, **Then** it additionally discloses the stacked Morpho curator fee; the launch vault line contains no "Morpho" wording.

---

### User Story 5 - The caps meter reflects the live on-chain CapRegistry (Priority: P2)

The per-user / total / vault caps shown on the vault surface, the deposit guard, and the Trust Center meter are read live from the deployed `CapRegistry`, falling back to the versioned policy mirror only when the read is unresolved.

**Why this priority**: A latent honesty/robustness gap — if governance changes a cap on-chain, the displayed number silently goes stale. Cheap to fix; display-only (enforcement already uses the on-chain `maxDeposit`).

**Independent Test**: On Base Sepolia, read the meter denominator; change the on-chain cap via `setPerUserCap` and refetch — the meter tracks the new value. Point at a chain without a deployed `CapRegistry` and confirm the meter falls back to the mirror with no error.

**Acceptance Scenarios**:

1. **Given** a deployed `CapRegistry`, **When** the vault surface renders, **Then** the per-user cap denominator and utilization derive from the live `perUserCap()` read, not the compile-time mirror.
2. **Given** an unresolved read / a chain without `CapRegistry`, **When** the meter renders, **Then** it uses the versioned policy-mirror value — no blank, no zero, no fabricated cap, no thrown error.
3. **Given** the cap reads fail, **When** the vault view resolves, **Then** `useVault`'s `isLoading`/`isError` are unaffected (cap reads are excluded from the aggregate) and signing/withdraw paths are untouched.

---

### User Story 6 - The standalone /confirm route runs the identical real trust gate (Priority: P2)

Opening `/confirm/deposit?assets=…` (or `/confirm/withdraw?assets=…|?shares=…`) with the amount context runs the exact same pre-trade preview → guardrail checklist → sign-disabled-until-acknowledged gate that the chat-inline card and the vault amount screen run — one gate, two mount points (spec-001 US2 FR-054).

**Why this priority**: FR-054 requires both surfaces to run the identical gate. The route currently only ever shows an inert "ships at launch" placeholder. Fixing it removes a trust-surface inconsistency; scoped as P2 because the primary sign paths (chat + vault) already work.

**Independent Test**: Open `/confirm/deposit?assets=1000000` with an allowlisted connected wallet and confirm the real `<ConfirmFlow onchain>` gate renders (not the placeholder); open `/confirm/deposit` with no amount and confirm the live amount-entry screen renders (which runs the same gate on confirm); confirm `/confirm/deposit` for a non-allowlisted wallet renders the beta gate; confirm `/confirm/swap` still shows the honest non-signable placeholder.

**Acceptance Scenarios**:

1. **Given** a usable amount in the URL + a connected allowlisted wallet within cap, **When** `/confirm/deposit` renders, **Then** the real gate renders, identical to the chat-inline and amount-screen gates for the same amount.
2. **Given** no usable amount, **When** the route renders, **Then** the live amount-entry screen renders (never the dead placeholder, never a fabricated amount).
3. **Given** a non-allowlisted wallet, **When** `/confirm/deposit` renders, **Then** the beta gate renders; `/confirm/withdraw` is never beta/pause/cap-gated.
4. **Given** `swap`/`premium`/`bridge`, **When** the route renders, **Then** the honest non-signable placeholder renders (those intents are not live).

---

### Edge Cases

- **Onboarding offline / no wallet**: confirm surfaces an error state; never a silent "saved" advance. Exit-anytime is unaffected (advisory config only).
- **Mandate read errors / non-beta wallet**: the surfaces show an honest error state; never mock numbers; never a crash.
- **Recommendations quota-exhausted (503)**: the page falls back to `MOCK_RECS` (static copy, no chip); citations absent when the embedding backend is unset → chip hidden, rationale still shown.
- **CapRegistry not deployed on a chain (Base mainnet / 46630 / local fork)**: caps fall back to the mirror; no read against an undefined address.
- **`/confirm` decimal / negative / zero / non-numeric amount**: rejected → live amount entry (never mis-scaled).
- **Non-custody**: no fix touches custody, signing authority, or the withdraw/exit path. Mandates are advisory config; caps are display-only; the confirm gate still fail-closes every signature (N1/N3, N2 exits untouched).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Onboarding MUST persist the local `buildMandateDraft(answers)` object (saved == shown), with `riskProfile ∈ {conservative,moderate,growth}` and goal-kind ordering that maps "Aggressive growth" → `aggressive_growth`.
- **FR-002**: The onboarding confirm MUST be awaited with explicit saving/saved/error UI; it MUST NOT silently no-op offline or advance on failure.
- **FR-003**: A `useMandate()` reader MUST fetch `GET /agent/mandate` through the same-origin GET/POST BFF (session-derived owner) and expose honest disconnected/loading/error/empty/ready states.
- **FR-004**: Settings → Mandate, the chat right-rail card, and the portfolio drift row MUST render the real mandate (or the honest fallback), never a hardcoded tier-1 mock.
- **FR-005**: The recommendations DTO/view MUST carry `citations`; `/strategies` cards MUST render the live rationale in the "Why this?" expander and a source chip listing real citations, with the mock fallback preserved and `usingMock` corrected to `liveRecs === null`.
- **FR-006**: The deposit confirm gate MUST render the canonical `PERFORMANCE_FEE_DISCLOSURE` verbatim plus a "Management fee · 0% — none" row, on both the route and chat-inline mounts.
- **FR-007**: The withdrawal receipt MUST render an accrued-performance-fee disclosure keyed to the live `performanceFeeBps` (no fabricated dollar figure); wrapper vaults MUST disclose the stacked curator fee.
- **FR-008**: `useVault` MUST read `perUserCap()/totalCap()/vaultCap()` live from `CapRegistry`, exposed as `perUserCap/totalCap/vaultCap`, excluded from the `isLoading/isError` aggregate, with per-cap fallback to the policy mirror.
- **FR-009**: The vault-page meter, the deposit guard label, and the `NonCustodyBadge` `CapsMeter` MUST prefer the live cap and fall back to the mirror per cap.
- **FR-010**: The standalone `/confirm/[intent]` route MUST thread `?assets=/?shares=/?vault=` (raw base units) into the shared `useVaultConfirm` and render the identical `<ConfirmFlow onchain>` gate; with no usable amount it MUST render the live amount-entry screen; deposit MUST stay behind the beta gate; withdraw MUST NOT be beta/pause/cap-gated.
- **FR-011**: No fix may change the agent service, smart contracts, the DB schema, or add a migration; all changes are within `apps/web`.
- **FR-012 (non-custody invariant)**: No fix may create a code path that moves user funds, gates a withdraw/exit, or makes a non-policy-approved action signable. Mandates are advisory; caps are display-only.

### Key Entities

- **MandateDraft / MandateWire / MandateView**: advisory config (goals, riskProfile, riskParams, summaryText) — the plan the user chose; never authorizes funds.
- **RecView + RecCitation**: a ranked card + its real Obsidian provenance set.
- **LiveVaultCaps**: the live CapRegistry per-user/total/vault caps (raw USDC base units).
- **ConfirmParams**: the parsed `?assets=/?shares=/?vault=` amount context for the standalone confirm route.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-run onboarding of a non-default plan persists a mandate whose goal/tier/timeline match the selections in ≥ 99% of runs (0 shown-vs-saved divergences in the unit suite; tier ≥ 4 never 400s).
- **SC-002**: All three mandate surfaces render the real persisted mandate for a signed-in wallet with a mandate; 0 hardcoded tier-1 renders remain in the code.
- **SC-003**: A live rec card with citations shows a source chip and real rationale; the mock fallback shows no chip; malformed citations never crash a card.
- **SC-004**: The deposit gate shows the verbatim disclosure byte-identical to the agent constant (locked by a unit test) on both mounts; the withdrawal receipt shows the live-% accrued-fee line.
- **SC-005**: The caps meter tracks a live `setPerUserCap` change on Base Sepolia and falls back to the mirror where `CapRegistry` is absent, with no error/loading regression.
- **SC-006**: `/confirm/deposit?assets=…` renders the real gate; `/confirm/deposit` (no amount) renders live amount entry; a non-allowlisted wallet gets the beta gate; `/confirm/swap` shows the placeholder.
- **SC-007**: `pnpm --filter web test` (new unit suites) + `pnpm --filter web build` + agent `pytest`/`ruff`/`mypy` all green; `changelog-required` CI green.

## Assumptions

- `GET /mandate` returns `{ mandate: {…}|null }`; `GET /recommendations` returns `citations[]` per item; both proxy through the GET/POST BFF with session-derived owner. (Verified in the investigation.)
- `CapRegistry` is deployed on Base Sepolia with `perUserCap()/totalCap()/vaultCap()` and is in the shared address book + ABI. (Verified — the Trust Center already reads it.)
- `PERFORMANCE_FEE_DISCLOSURE` already exists in `NonCustodyBadge.tsx`, verbatim-mirroring the agent's `_DEPOSIT_DISCLOSURE`.
- Web tests are pure `node:test` files run under `node --experimental-strip-types`; new logic lives in dependency-free `lib/` modules with type-only `@sparkpoint`/`@/` imports.
- The operator env toggles (portfolio indexer, embedding backend, premium billing, vault factory address, demo-wallet allowlist) are applied out-of-band on the alpha agent; they are not code and are tracked separately in this feature's go-live notes.
