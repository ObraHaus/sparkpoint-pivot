# Feature Specification: Phase-3 descope register + P1 quick wins

**Feature Branch**: `feat/016-phase3-gates-p1-quickwins`

**Created**: 2026-07-23

**Status**: Draft

**Input**: After the P0 alpha fixes (015), close two milestone-honesty gaps and two P1 quick wins found in the Jul-23 gap audit: (1) formally RECORD the Phase-3 deferrals so nothing ships as a silent mock; (2) add the one missing honest badge (Notifications bell drawer) + de-fake the admin sample-data chart provenance; (3) add a Trust Center "Whitelisted protocols" card sourced from the real policy allowlist; (4) persist the /settings notification + display preferences (per-device) and make density/reduce-motion actually work. Frontend + docs only — no agent/contract/DB/migration change.

## Clarifications

### Session 2026-07-23
- **Q: Where do the Phase-3 deferrals get recorded?** → **A: A new canonical register `docs/phase-3-deferred.md`** (companion to `known-limitations.md`: that doc caveats what IS live; this lists what's intentionally NOT built, why, its honest in-app state, and the gate to build it), cross-linked from `known-limitations.md`, `GATES.md`, `architecture-as-built.md`, and the `wave-state.json` P3 entry. An anti-rot doc test guards the referenced paths + JSON validity.
- **Q: Settings prefs — server-backed or device-local?** → **A: Device-local (localStorage via the existing `useLocalState`).** There is no notification-delivery pipeline, so a server pref would gate nothing; density + reduce-motion are inherently per-device. Honest label: prefs are saved on this device; delivery isn't wired.
- **Q: Which protocols does the Trust card list?** → **A: The real policy allowlist join only** (`getPolicyConstants(chainId).allowlist` × `resolveTargetRef`), excluding the vault (already in "Contracts & roles") and the Morpho mock wrapper (Principle III — never label a MockMorphoVault as "Morpho"). On Base Sepolia that is exactly **Aave v3 Pool**. No hardcoded addresses.
- **Q: Any missing honest badges?** → **A: One** — the Notifications bell drawer (`OverlayProvider`), badged like the `/notifications` page. Plus the admin sample-data chart footers falsely claim live provenance ("RPC + materialized · 42s ago") under a "Sample data" pill — relabel to honest "sample data" provenance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Phase-3 deferrals are formally recorded (Priority: P1)

A reviewer/client can open one register that lists every intentionally-deferred feature, why it's deferred, the honest in-app state a user sees today, and the condition (gate) to build it — so nothing ships as a silent mock for the milestone.

**Why this priority**: Constitution III (provable, not promised) + the milestone requires that every not-yet-built surface is honestly disclosed AND tracked. This makes "we descoped X to Phase 3" auditable rather than implicit.

**Independent Test**: Open `docs/phase-3-deferred.md`; confirm all 8 deferred items each have why / current-state+disclosure / gate / tracking; confirm each cross-link resolves and `wave-state.json` stays valid JSON.

**Acceptance Scenarios**:
1. **Given** the register, **When** a reviewer reads it, **Then** all 8 deferred items (US6 automation, Sui/bridge, Aerodrome, real Morpho+APY feed, notifications, admin analytics, US5 outcomes, US2 sim-REST+direct-Aave) appear with the four fields each.
2. **Given** each register row, **When** it cites the app's honest disclosure, **Then** that disclosure (a StatusTag/pill/empty-state) actually exists in the app.
3. **Given** the cross-linked docs, **When** they're opened, **Then** each points at the register; `wave-state.json` P3 lists the items and remains valid JSON.

---

### User Story 2 - Every mock/deferred surface carries an honest badge (Priority: P1)

A user never sees fabricated data presented as real: the Notifications bell drawer shows a "Preview data" badge, and the admin sample-data pages don't claim live pipelines.

**Why this priority**: Direct milestone-honesty requirement; the bell drawer opens on every app page and currently shows fabricated events with no indicator.

**Independent Test**: Open the bell drawer on any app page → a "Preview data" badge appears above the rows. Open `/admin/tvl` (and home) → chart footers read a static "sample data" provenance, not "RPC + subgraph · 42s ago".

**Acceptance Scenarios**:
1. **Given** the bell drawer, **When** it opens, **Then** a `mock` StatusTag ("Preview — notifications aren't wired…") shows above the rows.
2. **Given** an admin sample-data page, **When** its charts render, **Then** their provenance footers do not assert a live pipeline/freshness under the "Sample data" pill.
3. **Given** the "Prove it" drawer, **When** it renders, **Then** it is unchanged (already honest — "No automation granted").

---

### User Story 3 - Trust Center shows the whitelisted protocols (Priority: P2)

A user opens `/trust` and sees a "Whitelisted protocols" card listing the closed set of on-chain venues the agent may route into — on Base Sepolia, Aave v3 Pool — each with its real address + Basescan link.

**Why this priority**: Completes the "legible guardrails / provable non-custody" story; answers "where can the AI actually put my money?" from the real on-chain allowlist.

**Independent Test**: Open `/trust` (no wallet) → the card lists Aave v3 Pool with address `0x8bAB…aE27`, actions "Supply · Withdraw", and a working `sepolia.basescan.org` link; the vault isn't duplicated; Aerodrome doesn't appear.

**Acceptance Scenarios**:
1. **Given** the policy allowlist, **When** `/trust` renders, **Then** the card lists each external allowlisted venue resolved to its real address — no hardcoded address (Principle III).
2. **Given** an unresolved/undeployed target, **When** the card derives, **Then** it is dropped (fail-closed) — no placeholder; the Morpho mock wrapper is never shown as "Morpho".
3. **Given** an empty allowlist join, **When** the card would render, **Then** it is hidden (no empty shell).

---

### User Story 4 - Settings preferences persist per-device (Priority: P2)

A user's notification toggles and display preferences (density, reduce-motion) survive a reload, and compact density + reduce-motion actually apply across the app.

**Why this priority**: The audit flagged settings prefs as unpersisted "pref theater"; this makes them real (per-device) and honest.

**Independent Test**: Toggle a notification switch + set Compact + Reduce-motion → reload `/settings`: state persists; the app is visibly denser + animations are suppressed. Corrupt the stored blob → the UI still resolves to a complete, sane state.

**Acceptance Scenarios**:
1. **Given** a changed toggle/density/motion pref, **When** the page reloads, **Then** the pref is retained (localStorage, per-device).
2. **Given** Compact density / Reduce-motion enabled, **When** the app renders, **Then** `.setrow`/`.card-pad` tighten and CSS transitions/animations are suppressed app-wide (landing WebGL excepted).
3. **Given** a corrupt/partial stored blob, **When** prefs load, **Then** they coerce to a complete default-merged object (never a crash, never missing keys).
4. **Given** storage is disabled (private mode), **When** toggles are used, **Then** they work for the session without throwing (no persistence).

### Edge Cases
- No wallet / disconnected: the Trust card still renders (public, RPC-only); settings prefs are wallet-independent.
- SSR/hydration: prefs use the existing `useSyncExternalStore` hook (same as TipWidget) — a one-frame default flash on reload is expected/benign.
- Reduce-motion is an explicit app override (not "follows system"); the landing WebGL reads `matchMedia` directly and is intentionally not governed.

## Requirements *(mandatory)*

- **FR-001**: `docs/phase-3-deferred.md` MUST list all 8 deferred items with why / current-state+disclosure-ref / gate / tracking, each disclosure verified to exist in-app.
- **FR-002**: `known-limitations.md`, `GATES.md`, `architecture-as-built.md` MUST cross-link the register; `wave-state.json` P3 MUST list the items and remain valid JSON.
- **FR-003**: The Notifications bell drawer MUST render a `mock` StatusTag; the "Prove it" drawer MUST stay unchanged.
- **FR-004**: Admin sample-data chart provenance footers MUST NOT claim a live pipeline/freshness under the "Sample data" pill.
- **FR-005**: `/trust` MUST render a "Whitelisted protocols" card from the real allowlist→address join (no hardcoded address), excluding the vault and the Morpho mock, hidden when empty.
- **FR-006**: `/settings` notification + display prefs MUST persist to localStorage via `useLocalState`, coerce partial/corrupt blobs to a complete object, and apply density/reduce-motion app-wide; the StatusTag MUST honestly separate saved-prefs from unwired delivery.
- **FR-007**: No agent/contract/DB/migration change; all code within `apps/web` (+ docs).
- **FR-008 (non-custody)**: No fix moves funds, gates withdraw/exit, or makes a non-approved action signable. The Trust card is read-only; prefs are cosmetic; badges are informational.

### Key Entities
- **Phase-3 register**: the deferral doc (8 rows).
- **WhitelistedProtocol**: an allowlisted (protocol, target) resolved to a real address + permitted actions.
- **NotifPrefs / DisplayPrefs**: device-local settings, coerced fail-safe.

## Success Criteria *(mandatory)*
- **SC-001**: The register lists 8 items; every cited disclosure exists; docs cross-link; `wave-state.json` valid JSON — guarded by an anti-rot doc test.
- **SC-002**: 0 user-visible mock surfaces without an honest badge (bell drawer now badged; admin provenance de-faked).
- **SC-003**: `/trust` shows Aave v3 Pool from the real join; 0 hardcoded addresses added.
- **SC-004**: Settings prefs persist across reload; density/reduce-motion apply; corrupt blob coerces.
- **SC-005**: `pnpm --filter web test` (new units) + `build` + `tsc` + `eslint` green; `changelog-required` green.

## Assumptions
- `getPolicyConstants(chainId).allowlist` strips undeployed entries (Aerodrome on 84532); `resolveTargetRef` joins to the address book. (Verified.)
- `useLocalState` is the repo's SSR-safe localStorage hook (used by TipWidget/WhatsNewModal).
- Web tests are pure `node:test` under strip-types; new logic in dependency-free `lib/` modules.
