# Feature Specification: Force-Refresh on New Release + What's New Greeting

**Feature Branch**: `006-force-refresh-whats-new`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "Alpha release-safety: when a new version of the SparkPoint web app is deployed, move every open session onto it automatically (without ever interrupting a signature, a broadcast transaction, or the withdraw path), greet the user with what changed, and make it impossible for a future feature to ship with a blank in-app changelog or a version that fails to trigger the refresh."

## Clarifications

### Session 2026-07-20

- Q: Countdown length and cancellability? → A: 60-second countdown, **not user-cancellable**; only funds/data-safety gating pauses it; a "Reload now" action may skip the wait.
- Q: Detection cadence? → A: Poll roughly every **60 seconds** plus an on-tab-focus re-check.
- Q: Maximum defer window for a stuck critical/data-loss operation? → A: **10 minutes**, after which the system surfaces a manual refresh. The exit/trust never-reload rule (N2) is absolute regardless of this window.
- Q: Loop-breaker window? → A: If a reload does not clear the release mismatch within **~30 seconds**, stop auto-reloading and offer a manual refresh.
- Q: First-time user with no last-seen marker — greet them with the whole backlog? → A: **No.** Initialize the marker to the current release silently on first load; the greeting is only for users crossing from an older seen release to a newer one.
- Q: Enforcement model / hard block? → A: **GitHub Free + a merge-gating hook plus the pre-merge check signal**; server-side branch protection is out of scope for now.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Land on the newest release automatically (Priority: P1)

A tester has the alpha open in a tab. The team deploys a new build. Within about a minute, the tester's tab notices it is running old code, shows a brief, unobtrusive notice ("A new version is ready"), counts down, and reloads onto the new build — so no one keeps using stale code or hits a broken screen from missing assets.

**Why this priority**: This is the core value and the reason the feature exists. Push-to-deploy swaps the running app underneath open tabs; without this, testers silently run old code and can hit hard load failures when the old assets disappear. Delivered alone, it already prevents the stale-client problem.

**Independent Test**: Deploy a change, keep a tab open from before the deploy, and confirm the tab detects the new release and reloads onto it within the expected window without any manual action.

**Acceptance Scenarios**:

1. **Given** an idle tab running build A, **When** build B is deployed, **Then** within ~1 minute the tab shows the update notice and, after a short countdown, reloads onto build B.
2. **Given** the update notice is showing, **When** the user chooses "Reload now", **Then** the tab reloads immediately instead of waiting for the countdown.
3. **Given** the update notice is showing, **When** the user tries to dismiss or cancel it, **Then** there is no dismiss/cancel affordance — the reload is not user-cancellable (only funds/data safety can pause it).
4. **Given** a redeploy that changed only configuration or dependencies (same source commit), **When** it goes live, **Then** open tabs still detect a new release and reload (the release identity changes on every real deploy, not only on a code commit).

---

### User Story 2 - A reload never interrupts money or work (Priority: P1)

A user is signing a deposit, has a withdrawal transaction broadcast and awaiting confirmation, is on the self-custody exit page, is mid-way through a streaming chat answer, has an unsent message drafted, or is editing admin content — and a new release goes live. The pending reload waits until it is safe, and never fires on the withdraw/exit path.

**Why this priority**: This is non-negotiable and constitutional. Per Non-Custody invariant N2 (withdraw-always) the exit path must never be blocked or disrupted, and a reload during a broadcast-but-unconfirmed transaction could make a user re-submit and move funds twice. Safety gates the entire feature; without it the auto-reload would be unacceptable in a funds app.

**Independent Test**: Start each protected operation (signing, pending tx, exit page, streaming chat, unsent draft, dirty admin editor), trigger a new-release condition, and confirm the reload defers until the operation completes and never occurs on the exit/trust pages.

**Acceptance Scenarios**:

1. **Given** a transaction is broadcast but not yet confirmed, **When** a new release is detected, **Then** the reload is paused and the notice explains it will refresh once the operation is done; it resumes only after the transaction settles.
2. **Given** the user is on the self-custody exit path, **When** a new release is detected, **Then** the app never auto-reloads that page.
3. **Given** a chat answer is streaming or a message is drafted but unsent, **When** a new release is detected, **Then** the reload is deferred and any unsaved input is preserved across the eventual reload.
4. **Given** a protected operation is somehow stuck open far beyond a reasonable time, **When** the maximum defer window elapses, **Then** the system stops deferring and surfaces a manual refresh rather than waiting forever (the exit/trust exception still holds).

---

### User Story 3 - Know what changed, and never see a blank greeting (Priority: P2)

Right after an update-driven reload — and when a returning user opens the app to find it newer than the last version they saw — a short, friendly "What's new" greeting lists what changed since they were last here (New / Improved / Fixed). It appears only when there is genuinely something new, and never as an empty box.

**Why this priority**: A silent reload is jarring and the changelog is the team's shopfront to testers. This turns the reload into a moment of value. It builds on P1 but the app is still viable without it.

**Independent Test**: With at least one new changelog entry present, trigger an update reload and confirm the greeting lists the new items; with no new entries, confirm the greeting does not appear at all.

**Acceptance Scenarios**:

1. **Given** the user reloaded onto a new build that has one or more changelog entries newer than their last-seen version, **When** the app loads, **Then** the greeting appears listing those entries and a link to the full changelog.
2. **Given** the greeting is showing, **When** the user acknowledges it ("Got it"), **Then** it marks the current version as seen and does not reappear for that version.
3. **Given** a new build with no client-facing changelog entries (e.g. an infra-only deploy), **When** the app loads, **Then** no greeting appears (never a blank one) — the user still received the fresh code.
4. **Given** a signed-out visitor on the public landing, **When** they load the site, **Then** no greeting appears (the greeting is for authenticated app users only).

---

### User Story 4 - The team cannot ship a blank changelog or a dead refresh (Priority: P3)

When a developer (or an AI coding agent) proposes a change that alters what users see, the process makes it structurally hard to forget the housekeeping: the release identity updates on its own, and a change to user-facing behavior cannot merge without both changelog surfaces being updated (with an explicit, auditable opt-out for infra-only changes).

**Why this priority**: The force-refresh puts the changelog in front of every user seconds after each deploy, so a forgotten entry becomes immediately visible. This story hardens the process so the P1–P3 promises hold on every future deploy, not just today's. It is lower priority only because it protects the feature rather than delivering it.

**Independent Test**: Open a change that touches user-facing product code without a changelog entry and confirm the pre-merge check fails; add the entry (or the documented infra-only opt-out) and confirm it passes.

**Acceptance Scenarios**:

1. **Given** a proposed change that modifies user-facing product code without a corresponding client changelog entry, **When** it is checked before merge, **Then** the check fails and the change cannot be merged (and therefore cannot deploy).
2. **Given** an infra-only change with no user-facing effect, **When** the author applies the documented opt-out marker, **Then** the check passes and the opt-out is recorded for audit.
3. **Given** any real deploy, **When** it goes live, **Then** the release identity has changed automatically with no manual version bump required.

---

### Edge Cases

- **Release signal unavailable or ambiguous**: If the app cannot determine the running release (the signal is empty, unreachable, or returns something other than a valid release identity), it does nothing — it never guesses "new" and never reloads on uncertainty.
- **Reload does not resolve the mismatch**: If the app reloads for a new release but still sees a mismatch shortly after, it stops re-reloading and offers a manual refresh, so a bad deploy can never trap a user in an endless reload loop.
- **Construction gate**: On environments where only the marketing landing is public, the release-check path must still be reachable and return a valid signal rather than being redirected to the landing page.
- **Rolling / multi-replica deploys**: During a deploy where replicas briefly differ, a single transient reading must not falsely trigger a reload (require corroboration before acting).
- **Returning after a long absence**: A user who was away for several releases sees a single greeting summarizing changes since their last-seen version, not one greeting per missed release.
- **Brand-new user**: A first-time visitor is not greeted with the entire changelog backlog; their last-seen marker is set to the current release silently.
- **Admin-edited vs shipped changelog entries**: If an operator hand-edits a changelog entry live, a subsequent deploy that re-ingests the shipped source must not silently revert the operator's edit.
- **Duplicate entries on redeploy**: Re-publishing the shipped changelog on every deploy must not accumulate duplicate entries.

## Requirements *(mandatory)*

### Functional Requirements

**Release detection & refresh**

- **FR-001**: The system MUST associate each deployed build with a release identity that changes on every real deploy — including a deploy that changed only configuration or dependencies — without any human action to bump it.
- **FR-002**: An open session MUST be able to learn the running deployment's current release identity and compare it to the identity it started with, re-checking on a recurring interval and when the tab regains focus.
- **FR-003**: When (and only when) the running identity is a valid value that differs from the session's own, the system MUST present a persistent, non-cancellable update notice and reload the session onto the new release after a fixed short countdown (target 60 seconds), with an option to reload immediately.
- **FR-004**: The system MUST treat an empty/unknown release identity, an unreachable check, or a malformed response as "no change" and MUST NOT reload on such uncertainty.
- **FR-005**: The system MUST require corroboration (more than one consistent reading) before treating a difference as a real new release, to tolerate brief divergence during rolling deploys.
- **FR-006**: If a reload does not clear the release mismatch within a short window, the system MUST stop automatically reloading and MUST offer a manual refresh instead (loop-breaker).

**Safety gating (non-custody)**

- **FR-007**: The system MUST NOT reload while a funds-critical operation is in flight — specifically while a transaction is being signed or has been broadcast but not yet confirmed — and MUST resume the pending reload only once it is safe.
- **FR-008**: The system MUST NOT reload while a data-loss-sensitive operation is active — a streaming chat response, an unsent message draft, or an unsaved admin edit — and MUST preserve unsaved input across the eventual reload.
- **FR-009**: The system MUST NEVER auto-reload the self-custody exit path or the trust/permissions page (N2: the withdraw-always escape hatch must never be disrupted).
- **FR-010**: The system MUST warn the user before any manual page unload while a funds-critical or unsaved operation is active (the app currently has no such guard).
- **FR-011**: Deferral MUST be bounded by a maximum window so a stuck operation cannot postpone an update indefinitely; when the window elapses the system surfaces a manual refresh (the exit/trust exception in FR-009 still applies).

**What's New greeting**

- **FR-012**: After an update-driven reload, and when a returning user's last-seen release is older than the current one, the system MUST present a greeting listing the client-facing changes since the user's last-seen version, each tagged (New / Improved / Fixed) with a link to the full changelog.
- **FR-013**: The greeting MUST appear only when there is at least one new client-facing entry; it MUST NOT render an empty or error state, and MUST silently advance the last-seen marker when there is nothing to show.
- **FR-014**: Acknowledging the greeting MUST record the current release as seen so the greeting does not repeat for that release.
- **FR-015**: The greeting MUST be shown only to authenticated app users, never to anonymous/landing visitors.

**Changelog source of truth**

- **FR-016**: The client-facing changelog that powers both the in-app changelog page and the greeting MUST be populated from a committed source in the repository that is applied on deploy, so that publishing a client entry is a single edit that travels with the change.
- **FR-017**: Re-applying the committed changelog on deploy MUST be idempotent (no duplicate entries) and MUST NOT overwrite an operator's live hand-edit of an entry.
- **FR-018**: The client-facing changelog MUST remain a curated, tester-friendly register — it MUST NOT expose developer-only detail (file names, internal invariants, "requires a service redeploy", etc.).

**Housekeeping enforcement**

- **FR-019**: A pre-merge check MUST fail any change targeting the shared integration branch that modifies user-facing product code without both a developer changelog entry and a client-facing changelog entry, and MUST provide an explicit, auditable opt-out marker for changes with no user-facing effect.
- **FR-020**: The enforcement MUST bind the deploy: because a merge to the integration branch triggers the deploy, a failing check MUST prevent that merge under the agreed enforcement model (hook-bound agent merges plus the check signal; server-side branch protection is out of scope for now).
- **FR-021**: A feature is "done" only when both changelog surfaces are updated (or the opt-out is applied and justified), the release identity is confirmed to change on deploy, and the refresh/greeting behavior is verified end-to-end — captured as a standing Definition-of-Done that every future feature inherits.

**Rollout safety**

- **FR-022**: The capability MUST be deliverable in stages such that the release-detection and safety-net behavior can be present and verified with the auto-reload disabled, and the auto-reload is enabled only after the safety nets are proven.

**First-run behavior**

- **FR-023**: A first-time user with no last-seen marker MUST have the marker initialized to the current release without any greeting (no backlog dump); the greeting appears only when a user crosses from an older seen release to a newer one.

### Key Entities *(include if feature involves data)*

- **Release identity**: A value that uniquely identifies a deployed build and changes on every real deploy; compared between what a session started with and what the server is currently running.
- **Client changelog entry**: A tester-facing record of a change — a stable identifier, a category (New / Improved / Fixed / Announcement), a title, a short body, an optional call-to-action, and a publish date — sourced from the committed repository file and shown in the in-app changelog and the greeting.
- **Last-seen marker**: A per-user record of the most recent release the user has been greeted for, used to decide whether (and with which entries) to show the greeting.
- **Critical-operation state**: A transient signal describing whether a funds-critical or data-loss-sensitive operation is currently active, used to pause the reload.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Within 3 minutes of a deploy, at least 95% of still-open sessions are running the new release (or have shown the update notice and are counting down).
- **SC-002**: Zero reloads occur while a transaction is pending or while the user is on the self-custody exit path (measured across the alpha: no incident of an interrupted signature/broadcast attributable to the auto-reload).
- **SC-003**: The "What's new" greeting never renders with zero items — 0 blank-greeting occurrences.
- **SC-004**: 100% of deploys change the release identity (no deploy leaves open sessions unaware), verified by the pre-deploy check that the running identity matches the built identity.
- **SC-005**: 0 deploys ship a user-visible change without a corresponding client changelog entry (measured over the alpha period), i.e. no "blank changelog" moments 60 seconds after a deploy.
- **SC-006**: A returning user who was away across multiple releases sees exactly one consolidated greeting, not one per missed release.
- **SC-007**: A deliberately broken release signal in a test never causes a reload loop — the loop-breaker surfaces a manual refresh within one cycle.

## Assumptions

- **Reuse of existing changelog surface**: The existing in-app changelog and its admin editing remain; this feature adds a committed repository source that feeds them, rather than replacing the admin-managed model. Operator live-edits take precedence over the shipped source.
- **Poll cadence**: A ~60-second recurring check plus an on-focus check is sufficient for "within about a minute" detection on the current single-container alpha; a longer cadence may be chosen for cost on multi-replica environments.
- **Countdown length**: The auto-reload countdown is 60 seconds and is not user-cancellable (only safety gating pauses it), per the operator decision.
- **Maximum defer window**: A stuck critical/data-loss operation defers the reload for at most **10 minutes** (confirmed 2026-07-20) before the system surfaces a manual refresh; the exit/trust never-reload rule (N2) is absolute regardless of this window.
- **Loop-breaker window**: If a reload does not clear the mismatch within ~30 seconds, the system stops auto-reloading and offers a manual refresh.
- **Greeting audience**: Only authenticated app users see the greeting because the in-app changelog is beta-gated; anonymous landing visitors are intentionally excluded.
- **Enforcement model**: Enforcement targets the current hosting (hook-bound agent merges plus a required-in-spirit check signal); a server-side hard block via branch protection is deferred (cost/plan decision).
- **Non-custody invariants hold**: All five non-custody invariants (N1–N5) remain intact; this feature only adds client-side refresh behavior and MUST NOT touch custody, signing, or the withdraw path except to avoid disrupting them.
- **Staged rollout**: Delivery follows a staged order — release identity and safety nets first (auto-reload disabled), then the committed changelog source, then the enforcement check, and the 60-second auto-reload enabled last.
