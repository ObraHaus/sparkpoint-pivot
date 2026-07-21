# Feature Specification: Limits & Priority Compute (free & premium tiers)

**Feature Branch**: `feature/008-limits-priority-compute`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Create a Limits & priority compute system for free and premium users. The granularity of the inclusions must be configurable in the admin panel and monitorable in the same admin panel. This is a prerequisite to the premium model / SRK subscription."

SparkPoint's AI assistant runs on a shared, self-hosted LLM gateway that today has **no per-user metering, no tiers, and no usage visibility** — the only throttle is a process-wide concurrency cap that is blind to who is calling. This feature introduces a **per-wallet limits engine** with two tiers (a fully-capable **free** tier and a higher-allowance **premium** tier), where every limit is **operator-configurable** and every bit of consumption is **operator-monitorable** from the existing admin panel. It is the groundwork the future Premium / SRK subscription flips on: this increment makes the tiers real and enforceable; how premium is *paid for* (SRK) is a separate later feature. Per the constitution, **SRK stays non-essential** and the free tier — including the vault, deposits, yield, swaps, and withdraw-always — is never gated by any limit.

## Clarifications

### Session 2026-07-21

Resolved with the operator before authoring (locked decisions):

- **Q: How does a wallet become "premium" at launch?** → **A: Admin grant.** An operator marks wallets premium (allowlist-style) for launch; the on-chain SRK payment path is a separate later feature and is NOT a prerequisite to enforcing tiers. (Constitution: SRK non-essential.)
- **Q: Where are per-tier limits authoritatively enforced?** → **A: Both layers.** The agent is authoritative (the hard refusal, closest to LLM spend); the web backend adds a soft pre-check for fast feedback and early load-shed. Both resolve tier live.
- **Q: What scale must limits hold across for the alpha?** → **A: Single-replica.** In-process metering is acceptable for one agent replica; a shared cross-replica metering/limiter backend is deferred hardening, out of scope here.
- **Q: Does the inference-gateway hardening ship in this increment?** → **A: Yes, bundled.** The aggregate spend/rate ceiling, network isolation, and TLS enforcement ship as part of this feature alongside the per-tier metering that monitors them.
- **Q: What is the quota window?** → **A: Rolling 24 hours, PH / Asia-Manila timezone, operator-tunable** (default; can be changed to calendar-day later).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Free users get fair, bounded assistant use without ever losing core capability (Priority: P1) 🎯 MVP

A person using SparkPoint on the free tier can chat with the AI assistant, get recommendations, and onboard freely up to a generous daily allowance. If they exhaust that allowance, the assistant tells them plainly and offers (once, dismissibly) the premium option — it never errors out, never blocks mid-answer, and never affects their money: the vault, deposits, yield, swaps, portfolio reads, and the withdraw-always exit keep working exactly as before.

**Why this priority**: This is the core of the feature and the product's central promise ("free is fully capable"). It protects the shared inference resource from being exhausted by a few heavy users while guaranteeing the non-custody invariants and the no-dark-patterns rule. Without it, nothing else matters — and it is a viable MVP on its own (a fair, enforced free tier that never touches funds).

**Independent Test**: With limits enabled and a low free chat allowance configured, drive a free wallet through its allowance of assistant turns; confirm each succeeds, the turn after the cap returns a clear "you've reached today's free limit" response (not an error or blank), and — throughout — vault quotes, deposit/withdraw flows, and portfolio reads are unaffected.

**Acceptance Scenarios**:

1. **Given** a free wallet with N turns of daily allowance remaining, **When** it sends an assistant message, **Then** the assistant answers normally and the remaining allowance decreases by one turn.
2. **Given** a free wallet that has used its full daily allowance, **When** it sends another assistant message, **Then** it receives a clear, human, non-blocking "daily free limit reached" message with a single dismissible upgrade prompt — and no partial/garbled answer.
3. **Given** a free wallet at or over its assistant limit, **When** it requests a vault quote, initiates a deposit, or exits/withdraws, **Then** those actions proceed unaffected (no limit is ever applied to funds movement or the withdraw path).
4. **Given** a limit is being evaluated, **When** the decision is to refuse, **Then** the refusal is delivered before any answer streaming begins (never as a truncated stream).

---

### User Story 2 - Operators configure the per-tier limits from the admin panel, live (Priority: P1)

An operator opens the admin panel and edits what each tier includes — daily assistant turns, recommendation runs, concurrency share, priority, and which model a tier reaches — and the change takes effect on the next request without a redeploy. Every change is recorded for audit.

**Why this priority**: The request explicitly requires configurable granularity in the admin panel. Limits that require a code change or redeploy to tune are unusable operationally (the agent currently needs a manual redeploy). Live, audited configuration is what makes the tiers a real product lever.

**Independent Test**: In the admin panel, change the free tier's daily assistant-turn allowance to a new value and save; confirm the next request from a free wallet is evaluated against the new value, and that an audit entry records who changed what and when.

**Acceptance Scenarios**:

1. **Given** an admin is signed in, **When** they open the limits configuration surface, **Then** they see each tier's current, editable inclusions (caps, priority, model access) rather than a static/preview list.
2. **Given** an admin edits a tier's daily assistant allowance and saves, **When** a user next makes a request, **Then** enforcement uses the new value with no redeploy.
3. **Given** any tier configuration change, **When** it is saved, **Then** an append-only audit record captures the actor, the field changed, the old/new value, and the time.
4. **Given** an admin attempts to set a cap that would strand the assistant (e.g. zero for the default tier), **When** they save, **Then** the system refuses with a clear reason (fail-safe: a misconfiguration must not silently break chat).
5. **Given** a non-admin, **When** they attempt to reach the limits configuration surface or its API, **Then** it is invisible to them (indistinguishable from not existing).

---

### User Story 3 - Operators monitor per-tier consumption and throttling from the admin panel (Priority: P1)

An operator opens the admin panel's usage view and sees, from real data, how much the assistant is being used broken down by tier, who the heaviest consumers are (pseudonymized), and how often requests are being throttled or denied — enough to tell whether limits are biting, whether the free tier is healthy, and whether an abuse spike is underway.

**Why this priority**: The request explicitly requires the system be monitorable in the same admin panel, and monitoring closes the loop on both fairness tuning and the security concern (an anomalous consumption spike is the signal of gateway abuse). The usage page today openly states it has no data source; this makes it real.

**Independent Test**: Generate assistant traffic across free and premium wallets including some that exceed caps; confirm the admin usage view reflects per-tier turn counts, a top-consumers list (masked wallets), and a throttle/deny rate — sourced from real usage records, not sample data.

**Acceptance Scenarios**:

1. **Given** assistant traffic has occurred, **When** an admin opens the usage view, **Then** it shows per-tier consumption for the current period from real records (no "sample data" placeholder).
2. **Given** some requests were throttled/denied by limits, **When** an admin opens the usage view, **Then** a throttle/deny rate (overall and per tier) is visible.
3. **Given** the usage view lists consumers, **When** it renders, **Then** wallet identities are masked by default and no prompt/message content is ever shown or stored in the usage records.
4. **Given** the usage data source is unavailable, **When** an admin opens the view, **Then** it degrades honestly (states it cannot load) rather than showing fabricated numbers.

---

### User Story 4 - Premium users get higher limits and priority under contention (Priority: P2)

A wallet designated premium has materially higher allowances than free and, when the system is under load, its assistant requests are served ahead of free requests. The premium designation is granted and revoked by an operator (for launch), takes effect promptly, and is auditable.

**Why this priority**: This is the differentiation the future subscription monetizes ("higher limits & priority compute"), and it must exist for the subscription to have anything to sell. It is P2 because the free-tier fairness/config/monitoring (P1) are the load-bearing core; premium sits on top of them.

**Independent Test**: Grant a wallet premium via the admin panel; confirm it now has the premium allowances, and — under simulated saturation — that a premium request is admitted/served ahead of a concurrent free request; revoke premium and confirm it reverts to free on the next request.

**Acceptance Scenarios**:

1. **Given** an admin grants a wallet premium, **When** that wallet next makes a request, **Then** it is evaluated against the premium allowances (higher than free) without the user re-authenticating.
2. **Given** the system is at its concurrency limit, **When** a premium and a free request contend, **Then** the premium request is served preferentially and the free request waits/degrades first.
3. **Given** an admin revokes a wallet's premium, **When** that wallet next makes a request, **Then** it is evaluated as free again.
4. **Given** any premium grant or revocation, **When** it happens, **Then** it is captured in an append-only audit record (who, which wallet, when).

---

### User Story 5 - The shared inference resource is protected by a hard ceiling, independent of app tiers (Priority: P2) 🛡️

Beyond per-user tiers, the platform enforces a system-level ceiling on total inference so that a bug, a runaway loop, or a leaked gateway credential cannot run the shared LLM budget away. The chat gateway is reachable only by SparkPoint's own backend, is served over TLS, and carries an enforced spend/rate ceiling on its credential.

**Why this priority**: Directly answers the operator's stated worry — that someone who discovered the gateway could consume the inference outside SparkPoint. Per-user tiers alone live inside the app and cannot bound a leaked-key or infrastructure abuse; a gateway-level ceiling and network isolation can. P2 because the current blast radius is availability (free models), but it becomes financial the moment a paid model is used.

**Independent Test**: Confirm the gateway refuses unauthenticated inference (already true); confirm it is not reachable from outside SparkPoint's backend network and only over TLS; confirm the gateway credential has an enforced aggregate spend + request-rate ceiling that, when exceeded, refuses further calls rather than continuing unbounded.

**Acceptance Scenarios**:

1. **Given** the gateway credential's aggregate ceiling is exhausted, **When** a further inference call is made, **Then** it is refused at the gateway (bounded), not served unbounded.
2. **Given** a request originates from outside SparkPoint's backend, **When** it reaches the gateway host, **Then** it cannot obtain inference (network-isolated), independent of whether a credential is presented.
3. **Given** a client connects over plain HTTP, **When** it reaches the gateway, **Then** it is upgraded/redirected to TLS so the credential is never sent in cleartext.
4. **Given** an abuse or runaway spike, **When** it occurs, **Then** it is visible in the admin usage monitoring (US3) as an abnormal consumption/throttle pattern.

---

### User Story 6 - Users see their own usage and get an honest, non-nagging upsell (Priority: P3)

A user can see how much of their current-period assistant allowance they've used, and — only when they actually reach a premium-only limit — is shown a single, dismissible note about what premium adds. There is no nagging, no modal on open, no countdown, and the note never re-appears for that limit once dismissed.

**Why this priority**: Transparency and the no-dark-patterns rule are product law, and a self-usage view is expected on the manage-subscription surface. It is P3 because it is user-facing polish atop the enforced engine; the engine (P1/P2) delivers the value first.

**Independent Test**: As a wallet near its cap, confirm a usage-this-period indicator reflects real consumption; on reaching a premium-only limit, confirm a single dismissible upsell appears, does not block the flow, and does not re-appear for that limit after dismissal.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they view their subscription/usage surface, **Then** they see their real used/remaining allowance for the current period.
2. **Given** a user reaches a premium-only limit, **When** it happens, **Then** a single, dismissible "this is a premium feature — here's what it adds" note is shown without blocking the current action.
3. **Given** the user dismisses that note, **When** they hit the same limit again, **Then** the note does not re-nag for that limit.

---

### Edge Cases

- **Tier resolution fails** (store unreachable, ambiguous state): the caller is treated as **free**, never premium (fail-closed to the lower tier).
- **Custody path**: no limit, throttle, or ceiling may ever apply to a withdrawal, exit, or the vault self-service redeem — these must remain available even when the assistant is fully throttled (constitution N2).
- **Multi-call turn**: a single assistant turn that fans out into several internal model calls is counted as **one** turn against the user's allowance, not several.
- **Idempotent retry**: a client retry of the same request (same idempotency key) must not double-count against the allowance nor be double-served.
- **Streaming boundary**: once a response begins streaming, the system can no longer refuse it; the admit/deny decision must be made before streaming starts.
- **Per-chain differences**: on networks that are chat + read-only (no vault), limits apply to the assistant but there is no custody path to accidentally gate.
- **Window boundary**: allowance resets on a defined, operator-configurable window (rolling period, project timezone); behavior at the boundary is well-defined (no negative or stuck counters).
- **Premium grant/revoke timing**: a just-granted upgrade (or revocation) takes effect on the next request without requiring the user to sign in again.
- **Concurrency race**: simultaneous requests from the same wallet cannot each pass a check that only one should (counting must be atomic).
- **Admin misconfiguration**: setting a blocking/zero cap on the default tier is refused so a config mistake cannot strand the assistant for everyone.

## Requirements *(mandatory)*

### Functional Requirements

**Tiers & assignment**

- **FR-001**: The system MUST define at least two tiers — a default **free** tier and a **premium** tier — each with its own set of inclusion values.
- **FR-002**: Every wallet MUST resolve to exactly one tier for each request; a wallet with no explicit assignment MUST resolve to the free (default) tier.
- **FR-003**: An operator MUST be able to grant and revoke a wallet's premium designation from the admin panel, with the change taking effect on the wallet's next request (no re-authentication required).
- **FR-004**: Tier resolution MUST fail closed — any inability to determine a wallet's tier MUST resolve to free, never premium.
- **FR-005**: For launch, premium MUST be grantable by an operator without any token/payment dependency; the SRK payment path is explicitly out of scope for this feature and MUST NOT be a prerequisite to enforcing tiers.

**Configurable inclusions (granularity)**

- **FR-006**: Each tier's inclusions MUST be operator-configurable and MUST include at least: daily assistant-turn allowance, daily recommendation-run allowance, a concurrency share, a priority level, and which model/quality the tier reaches.
- **FR-007**: Operators MUST be able to change any tier inclusion value from the admin panel and have it take effect on the next request WITHOUT a code change or redeploy.
- **FR-008**: The system MUST refuse an operator configuration that would strand the assistant for a tier (e.g. a zero/blocking allowance on the default tier), with a clear reason.
- **FR-009**: Every tier-inclusion change and every tier grant/revocation MUST be recorded in an append-only audit trail capturing the actor, the change, and the time.

**Enforcement**

- **FR-010**: The system MUST meter and enforce the assistant limits per wallet, keyed on the server-verified wallet identity (never a client-asserted identity).
- **FR-011**: Enforcement MUST count a whole assistant *turn* as one unit against the allowance, regardless of how many internal model calls that turn makes.
- **FR-012**: When a wallet is over an allowance, the system MUST refuse the request with a clear, human, non-blocking message BEFORE any response streaming begins, and MUST NOT emit a partial/garbled answer.
- **FR-013**: No limit, throttle, priority rule, or system ceiling may EVER be applied to a withdrawal, exit, vault redeem, or any funds-movement path; those MUST remain fully available even when the assistant is entirely throttled.
- **FR-014**: The free tier MUST remain fully capable — limits MUST apply only to advisory/AI compute (chat, recommendations, onboarding), never to the vault, deposits, yield, swaps, or portfolio/permission reads a user needs to act.
- **FR-015**: A retried request bearing the same idempotency key MUST NOT be counted more than once against the allowance.
- **FR-016**: Enforcement MUST be applied authoritatively at the agent (the closest layer to the LLM spend) and MUST additionally be pre-checked at the web layer for faster feedback; the two layers MUST agree on tier resolution.

**Priority compute**

- **FR-017**: Under contention for the shared inference resource, the system MUST serve higher-priority (premium) requests preferentially, and lower-priority (free) requests MUST wait or degrade first.
- **FR-018**: Premium tier MUST provide materially higher allowances than free and MAY provide access to a higher-quality/less-limited model, per the operator-configured inclusions.

**Monitoring**

- **FR-019**: The admin panel MUST show, from real usage records, per-tier consumption for the current period.
- **FR-020**: The admin panel MUST show a throttle/deny rate (overall and per tier) and a top-consumers view.
- **FR-021**: Usage monitoring MUST mask wallet identities by default and MUST NOT store or display any prompt/message content.
- **FR-022**: When a usage data source is unavailable, the monitoring surface MUST degrade honestly (state it cannot load) rather than present fabricated data.

**System-level protection (shared inference / gateway)**

- **FR-023**: The system MUST enforce an aggregate ceiling (spend and/or request-rate) on the shared inference gateway credential such that exceeding it refuses further calls rather than continuing unbounded.
- **FR-024**: The inference gateway MUST be reachable only from SparkPoint's own backend (network-isolated), so that discovering its address alone does not permit consuming inference.
- **FR-025**: The inference gateway MUST be served over TLS such that the gateway credential is never transmitted in cleartext, and it MUST continue to refuse unauthenticated inference requests.

**User transparency**

- **FR-026**: A signed-in user MUST be able to see their own used/remaining assistant allowance for the current period.
- **FR-027**: When a user reaches a premium-only limit, the system MUST surface at most one dismissible upsell for that limit, MUST NOT block the current action, and MUST NOT re-nag for that limit after dismissal; there MUST be no modal-on-open, countdown, or urgency pattern.

**Constitutional**

- **FR-028**: SRK MUST remain non-essential — no core capability, and nothing on the vault/custody/withdraw path, may be gated by SRK or by premium status.

### Key Entities *(include if feature involves data)*

- **Tier**: a named plan (e.g. free, premium) carrying the operator-configurable inclusion values (daily assistant allowance, daily recommendation allowance, concurrency share, priority level, model access, default flag). Free is the default.
- **Tier Assignment**: the mapping of a wallet to a tier, with its source (e.g. admin grant) and timestamps. Absence of an assignment implies the default tier.
- **Usage Counter**: a per-wallet, per-metric, per-window tally of consumption used for enforcement and monitoring; carries no message content.
- **Limit/Throttle Event**: an append-only record of an admit/deny/throttle decision (masked wallet, tier, metric, verdict, time) that feeds the monitoring surface.
- **Config-Change Audit**: an append-only record of every tier-inclusion change and tier grant/revocation (actor, change, time).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can change any per-tier inclusion value and it governs enforcement on the very next request, with **zero** redeploys.
- **SC-002**: A free wallet can complete 100% of its configured daily assistant allowance successfully; the first request past the allowance returns a clear limit message in **100%** of cases (never an error, blank, or partial answer).
- **SC-003**: **Zero** withdrawals, exits, vault redeems, or funds-movement actions are ever blocked, delayed, or degraded by any limit, throttle, or ceiling — verified across free, premium, and over-limit states.
- **SC-004**: The admin usage view reflects real consumption (per tier, top consumers, throttle rate) within **one monitoring interval** of the traffic occurring, with **no** sample/placeholder data.
- **SC-005**: Under saturation, a premium request is admitted/served before a contending free request in **100%** of tested contention cases; free requests are the first to wait/degrade.
- **SC-006**: A premium grant or revocation takes effect on the wallet's next request in under **one request cycle**, with no user re-authentication.
- **SC-007**: The inference gateway refuses unauthenticated inference (**100%**), is unreachable from outside the backend network, serves only over TLS, and enforces an aggregate spend/rate ceiling that bounds total consumption from a single credential.
- **SC-008**: **100%** of tier grants/revocations and tier-inclusion changes produce an audit record.
- **SC-009**: Free-tier assistant responsiveness (time-to-first-token, median) does not regress by more than an agreed threshold after limits/priority are enabled — i.e. limits do not make the free tier unusable.
- **SC-010**: **100%** of usage/monitoring records contain no prompt/message content and mask wallet identities by default.

## Assumptions

- **Identity** is the SIWE-verified wallet (owner EOA), derived server-side; the agent trusts the web backend's asserted identity per the existing service-to-service trust model (this feature does not change that boundary).
- **Premium is granted by an operator** for launch; the SRK-paid subscription (approve+pay / stake) is a **separate later feature** that will flip this engine on. Per the constitution, SRK stays non-essential.
- **Single agent replica** is assumed for the alpha, so in-process metering is acceptable; a shared cross-replica metering/limiter backend is a later hardening step, out of scope here.
- **Quota window** defaults to a rolling 24-hour period in the project timezone (PH / Asia-Manila) and is operator-tunable.
- **Enforcement lives at both layers** — the agent is authoritative; the web backend adds a soft pre-check — per the locked decision.
- **Gateway hardening** (aggregate ceiling, network isolation, TLS) is **in scope** for this increment.
- The existing admin panel, its admin-gating, its audit conventions, the usage-monitoring surface, and the reusable usage/limits UI primitive are available to build on (they exist today; the config and usage surfaces are currently placeholders awaiting this data).
- The current inference models are cost-free (rate-limited) upstream models, so the immediate abuse risk is **availability**, not spend; the design nonetheless bounds spend for when a paid model is used.
