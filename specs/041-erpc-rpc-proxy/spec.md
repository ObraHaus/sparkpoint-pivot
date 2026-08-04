# Feature Specification: RPC Proxy — resilient, cached chain access

**Feature Branch**: `039-erpc-rpc-proxy`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "Integrate a self-hosted RPC reverse proxy in front of every blockchain RPC dependency, per the approved implementation plan (artifact 254642b6, 2026-08-03): one operated intermediary for all chain reads across the three supported networks, staged configuration-only cutover (indexers → agent → browsers), removal of the provider credential from the public browser bundle followed by rotation, finalized-data-only caching with request deduplication and provider failover, account-abstraction submission pinned to the bundler-capable provider, and a new read-only 'RPC proxy' monitoring section in the admin System console."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chain reads survive provider failure (Priority: P1)

An alpha tester is using the app — portfolio, chat, vault quotes, swap quotes — while the primary RPC provider throttles or goes down. Today any provider error surfaces directly as a failed quote, an unavailable vault, or a broken chat turn, because no part of the platform retries or fails over. After this feature, the platform routes every chain read through an operated intermediary that retries, hedges, and fails over to an alternate provider, so the tester notices nothing.

**Why this priority**: This is the core value: the platform currently has zero tolerance for provider throttling while every consumer (agent and all browsers) shares one free-tier provider budget. One heavy user can today degrade the app for everyone. Resilience protects every other flow in the product.

**Independent Test**: With the intermediary serving the agent's reads, block or throttle the primary provider and run a scripted browser session (portfolio → chat turn → deposit quote). All reads succeed via failover; no user-visible errors.

**Acceptance Scenarios**:

1. **Given** the intermediary is serving agent chain reads, **When** the primary provider returns rate-limit errors, **Then** affected reads are retried against an alternate provider and complete successfully without surfacing an error to the user.
2. **Given** the primary provider is fully unreachable, **When** a user loads their portfolio, **Then** position data still renders from the alternate provider.
3. **Given** all providers for a network are unreachable, **When** a read is attempted, **Then** the existing fail-closed error behavior is preserved (an honest error, no fabricated data).
4. **Given** the intermediary itself is offline, **When** the operator restores the previous per-service configuration, **Then** the platform operates exactly as before the feature within minutes (no code rollback required).

---

### User Story 2 - The provider credential leaves the browser (Priority: P2)

Anyone can currently read the platform's RPC provider credential out of the public web bundle and burn its quota, degrading the app for all users. After the cutover, browsers talk to the platform's own endpoint, the credential exists only in server-side configuration, and the old credential is rotated so the previously published value is dead.

**Why this priority**: A publicly harvestable credential is a standing denial-of-service invitation against the shared free-tier budget. It cannot move funds, but it can make the app unusable and is trivially fixed by this feature.

**Independent Test**: Fetch the served JS bundle and verify the provider hostname/credential appears nowhere; verify the old credential no longer authenticates.

**Acceptance Scenarios**:

1. **Given** the browser cutover is complete, **When** the served web bundle is inspected, **Then** it contains no RPC provider credential or provider-keyed URL.
2. **Given** the cutover is verified, **When** the old credential is rotated, **Then** the app continues to operate (nothing still depends on the old value).
3. **Given** browsers use the platform endpoint, **When** a request arrives from a foreign web origin, **Then** it is refused, while requests from the platform's own origins succeed.
4. **Given** a non-browser client abuses the public endpoint, **When** its request volume exceeds the endpoint's budget, **Then** the paid provider's quota is protected by the per-consumer budget cap and real users continue to be served.

---

### User Story 3 - Operators see RPC health in the System console (Priority: P3)

An operator opens Admin → System and, alongside the existing service tiles, a new read-only "RPC proxy" section shows whether the intermediary is up, which providers are healthy and actually serving traffic (with latency, error rate, and share), how effective the cache is, and how much of the paid provider's budget is in use — refreshed continuously, with links to endpoints and the rollback runbook.

**Why this priority**: The intermediary becomes a single point through which all chain reads flow; operating it blind is not acceptable in a console whose job is "is it up, is it healthy". Depends on Story 1 existing but is separately shippable and testable.

**Independent Test**: With the intermediary running, open the System console section and verify every tile reflects live state; stop the intermediary and verify the section reports it unreachable while the rest of the console still renders.

**Acceptance Scenarios**:

1. **Given** the intermediary is healthy, **When** the operator opens the section, **Then** proxy status, per-provider health/latency/error/share, cache hit rate, and budget use are visible and no older than the refresh interval.
2. **Given** a provider's error rate trips its breaker, **When** the operator views the section, **Then** that provider is shown degraded with its breaker state, distinct from healthy providers.
3. **Given** a metric the intermediary does not report, **When** the section renders, **Then** that tile reads "not reported" — never "down" (absence is not failure).
4. **Given** the intermediary is unreachable, **When** the section renders, **Then** it says so plainly and offers the rollback runbook link; no mutating controls exist anywhere in the section.

---

### User Story 4 - Repeat reads stop costing money and time (Priority: P4)

The platform re-reads the same immutable data constantly: indexers re-scan finalized event ranges every few minutes, every user's browser polls the same public pages, and historical backfills re-fetch data that can never change. After this feature, finalized, immutable responses are answered from the intermediary's cache, and identical concurrent requests are collapsed into one provider call.

**Why this priority**: Efficiency compounds the other stories (budget headroom, faster indexing) but the product functions without it.

**Independent Test**: Run an event backfill twice; the second run completes with a small fraction of the provider calls of the first. Two simultaneous identical reads produce one provider call.

**Acceptance Scenarios**:

1. **Given** a finalized event range was fetched once, **When** it is fetched again, **Then** the answer is served without a new provider call.
2. **Given** data that can still change (balances, share prices, quotes), **When** it is requested repeatedly, **Then** every request is answered live — this feature MUST NOT cache mutable data.
3. **Given** an event backfill over a very large block range, **When** it runs through the intermediary, **Then** it completes without manual range tuning, regardless of any single provider's range limits.

---

### Edge Cases

- **Wrong network behind an endpoint**: if the intermediary (or a provider behind it) answers for the wrong chain, the platform's existing per-network chain-identity assertion must fail closed, exactly as it does for a misconfigured direct provider.
- **Account-abstraction submissions**: the five bundler methods are only ever answerable by the bundler-capable provider; they must never be load-balanced to a provider that would reject them. A submission during that provider's outage fails honestly (it is a write; there is no cached or alternate answer).
- **Stale-read hazard**: a user who just deposited must see the effect immediately; that is why this feature caches only data that can never change. Any future caching of mutable data is explicitly a separate feature with its own verification.
- **Self-service exit independence**: the public exit page is the product's escape hatch (constitution N2). It MUST NOT acquire the intermediary as a new SparkPoint-operated point of failure — its reads keep working with the intermediary fully offline.
- **Metrics scrape failure**: the console section degrades to "unreachable"/"not reported"; it never blocks or breaks the rest of the System console.
- **Public endpoint abuse**: origin restrictions stop browsers; command-line abuse is bounded by the public endpoint's own budget so it cannot exhaust the paid provider's quota.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All platform chain reads — agent request paths, background indexers, and web browsers — MUST be routable through a single operated intermediary, addressable per supported network (Base Sepolia, Ethereum mainnet, Robinhood testnet), with separately addressable consumer lanes for platform services and for browsers.
- **FR-002**: A failed or throttled read MUST be retried and failed over across providers transparently; a user-visible error is permitted only when every provider for that network has failed. Writes (transaction/user-operation submission) MUST NOT be retried in a way that could double-submit.
- **FR-003**: The intermediary MUST cache only responses that are provably immutable (finalized events, finalized blocks, confirmed receipts, chain identity). Mutable data — balances, share prices, allowances, quotes — MUST NOT be cached by this feature.
- **FR-004**: Identical concurrent requests MUST be collapsed into a single provider call.
- **FR-005**: The five account-abstraction methods (submission, gas estimation, receipt/lookup, entry-point discovery) MUST be served exclusively by the bundler-capable provider, regardless of load-balancing state.
- **FR-006**: Historical event queries MUST succeed over arbitrarily large block ranges without per-consumer range tuning, independent of any single provider's range cap.
- **FR-007**: The paid provider MUST be protected by a hard request budget that keeps the platform inside its free-tier throughput; the browser-facing lane MUST carry its own budget so third-party abuse cannot exhaust the paid provider's quota.
- **FR-008**: The browser-facing endpoint MUST refuse requests from web origins other than the platform's own.
- **FR-009**: After the browser cutover, no provider credential or provider-keyed URL may appear in any browser-delivered artifact, and the previously published credential MUST be rotated.
- **FR-010**: The cutover MUST proceed in independently reversible stages (background indexers → agent request path → browsers), each reversible by configuration restore alone, with no application code change required for any cutover stage.
- **FR-011**: The Admin → System console MUST gain a read-only "RPC proxy" section showing: intermediary status, per-provider health/latency/error-rate/traffic-share and breaker state, cache hit rate, calls saved, absorbed throttle events, and paid-provider budget use — refreshed on the console's existing cadence and restricted to admins.
- **FR-012**: The section's tiles MUST follow the console's tri-state contract: reported-healthy, reported-unhealthy, and not-reported are three distinct states, and a missing metric MUST render as "not reported", never as a failure.
- **FR-013**: The console section MUST contain no mutating controls; operational links (endpoints, metrics, uptime monitor, rollback runbook) are read-only conveniences.
- **FR-014**: Every supported network reached through the intermediary MUST pass the platform's existing fail-closed chain-identity verification.
- **FR-015**: Existing signing flows MUST be unchanged: per-action user signature, simulation-before-sign, and byte-verbatim signed payloads are untouched; the intermediary is read/relay infrastructure with no authority over transaction content.
- **FR-016**: The public self-service exit page MUST remain fully functional with the intermediary offline; it MUST NOT depend on any newly introduced SparkPoint-operated component.
- **FR-017**: The feature MUST ship with both changelogs updated: the developer changelog and a client-facing in-app entry.
- **FR-018**: The intermediary MUST be monitored by the platform's existing uptime monitoring alongside the other services.

### Key Entities

- **Provider (upstream)**: an external RPC endpoint (paid or public) serving one network; carries health state, latency/error statistics, an optional budget, and a served-methods scope.
- **Consumer lane (project)**: a named entry point into the intermediary with its own authentication posture, origin policy, and budget — one for platform services, one for browsers.
- **Routing policy**: the rules mapping method groups to providers (bundler methods → bundler-capable provider only; large-range event queries → range-capable route; everything else → healthiest provider).
- **Cache entry**: an immutable response keyed by network, method, and parameters; exists only for finalized/immutable data in this feature.
- **Health snapshot**: the point-in-time metrics set the console renders (per-provider and aggregate), including the possibility of absent metrics ("not reported").

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the primary provider deliberately throttled or blocked, a scripted user session (portfolio, chat turn, deposit quote, swap quote) completes with zero user-visible chain-read errors.
- **SC-002**: The served web bundle contains zero occurrences of any provider credential or provider-keyed URL, verified by automated inspection, and the old credential no longer authenticates after rotation.
- **SC-003**: Re-running a historical event backfill completes using at most 1% of the provider calls of the first run, and the first run requires no manual range tuning.
- **SC-004**: During a rapid-interaction browser session (repeated swap-quote typing plus polled pages), the paid provider's observed request rate never exceeds its configured budget and no throttle error reaches a user.
- **SC-005**: An operator can read intermediary status, each provider's health, cache hit rate, and budget use from the System console, with data no older than 15 seconds, including correct "not reported" rendering for absent metrics.
- **SC-006**: A session-key automation runs end-to-end (build, sign, submit, receipt) after the cutover, demonstrating account-abstraction submissions reach the bundler-capable provider exclusively.
- **SC-007**: Each cutover stage is reversed in under 5 minutes by configuration restore during a rollback drill, restoring the exact pre-feature behavior.
- **SC-008**: The public exit page loads and reads vault state correctly with the intermediary process stopped.

## Assumptions

- The approved implementation plan (artifact 254642b6, 2026-08-03) is the authoritative technical reference for this feature; this spec deliberately keeps provider/tool names out of requirements. The plan's technology selections (the specific proxy software, hosting, and configuration) belong to the planning phase.
- Alpha/testnet scale: current traffic fits comfortably inside the intended budgets; the feature is sized for headroom and resilience, not raw throughput growth.
- CI keeps using direct provider access (runners cannot reach the platform's private network); this is out of scope, not an oversight.
- Caching of mutable ("latest") data is explicitly deferred to a follow-up feature with its own freshness verification; nothing in this feature may depend on it.
- No new paid provider subscriptions are made in this feature; explorer-API (Etherscan-family) traffic is out of scope entirely.
- Deploying/reconfiguring the hosting platform and rotating the provider credential are operator-confirmed actions performed during rollout, per the repo's standing confirm-before-infra rule.
- The intermediary's configuration lives in infrastructure-as-code, not in any admin UI; the console only observes.
