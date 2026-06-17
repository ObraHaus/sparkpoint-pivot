# SparkPoint Pivot — Admin / Stakeholder Panel Plan

> **What this document is:** the authoritative plan for SparkPoint Pivot's **secret, admin-only** internal panel — the place where the team, stakeholders, and the client *observe* the product in motion: growth, TVL, usage, system health, and (the centerpiece) **revenue in graphical form**. It is designer- and engineer-ready: it specifies audiences, the access/security model, every dashboard with concrete metrics and Recharts chart types, the data pipeline, the screen inventory with states, the tech approach, and the delivery roadmap.
>
> **What this document is NOT:** code, and not a fee-authorizing document. The revenue dashboard *visualizes* the streams defined in [`../revenue-model/README.md`](../revenue-model/README.md); it does not introduce or enable any fee. Until the revenue-model §5.2 amendment is approved, the only live revenue is Phase-0 (treasury float + B2B groundwork), and the dashboard renders launch-era streams (swap-routing fee, premium AI tier) plus *projected/placeholder* lanes for future strategy-vault fees, clearly labeled as not-yet-live.
>
> **Reads-before:** [`../../specs/001-sparkpoint-pivot-mvp/plan.md`](../../specs/001-sparkpoint-pivot-mvp/plan.md) (four-layer architecture + data layer), [`../../specs/001-sparkpoint-pivot-mvp/data-model.md`](../../specs/001-sparkpoint-pivot-mvp/data-model.md) (entities/tables this panel reads), [`../revenue-model/README.md`](../revenue-model/README.md) (the revenue streams the central dashboard visualizes), and [`../design-handover/04-design-system.md`](../design-handover/04-design-system.md) (tokens, charts, risk palette — the admin panel reuses this design language).

---

## 0. The one hard constraint, stated first — NON-CUSTODY (read-only over funds)

**The admin panel is observe/read-only over user funds. It has NO ability to move, withdraw, sweep, reallocate, or otherwise touch any user asset — by construction, not by policy.** This is non-negotiable and flows directly from the product Constitution (Principle I, invariants N1–N5).

Concretely:

- **No write path to chain exists in the admin surface.** The admin BFF (§6) holds **no keys**, has **no signer**, can build **no transaction**, and exposes **no endpoint** that emits calldata, a UserOp, or anything signable. It is a strictly read/aggregate layer over the same data the product already indexes.
- **No admin endpoint can move funds even in principle.** There is no "withdraw on behalf of," no "rebalance user," no "pause user vault," no "force-redeem." Such selectors do not exist anywhere in the system (N1: no admin asset-movement selector); the panel cannot call what does not exist.
- **The one privileged thing the panel may surface is the EXISTING pause-only multisig kill-switch *status*** — i.e., it **displays** whether deposits are paused (`KillSwitch`/`Guardian`, read from chain). **The panel never triggers pause/unpause.** Pause is governed by the existing multisig (Constitution N5: multisig is pause-only), executed in the multisig's own tooling (e.g., Safe), entirely outside this panel. The panel is a *window*, not a *lever*. (And even pause never blocks withdrawals — N2 — so it is not a custody lever at all.)
- **Admin identity is separate from custody.** Admins authenticate via an admin-only identity system (SSO/2FA/allowlist — §2), which is **completely separate** from end-user wallet connect. An admin account is **not** a SparkPoint-controlled custody address; there is no SparkPoint co-signer or recovery path over user accounts (N3). Admin auth grants read access to *analytics*, never authority over *funds*.
- **Withdraw-always is unaffected.** Because the panel has no write path and pause is external + withdraw-exempt, nothing in this panel can impair the N2 withdraw-always guarantee. If the entire admin panel and its BFF were deleted, every user could still withdraw directly onchain.

> **Design rule for every screen in this doc:** if a control would *do* something to funds, it does not belong here. The panel answers "what is happening?" and "is the system healthy?" — never "make it do X to a user's money." The single apparent exception (kill-switch) is **status-display-only**; the action lives in the multisig.

---

## 1. Purpose & audiences

The admin panel is the **internal mission-control + stakeholder window** for SparkPoint. Its jobs:

1. **Run the product (ops):** see growth, usage, TVL, revenue, and system health at a glance; investigate anomalies; manage operational config that is *not* custody-critical (whitelist invites, beta caps display, feature flags).
2. **Inform stakeholders:** give investors/advisors a credible, mostly-graphical read on traction (users, TVL, revenue trajectory) without exposing raw internals or PII.
3. **Show the client:** a curated, non-technical, presentation-grade overview — *especially the revenue story in graphical form* — suitable to screen-share in a meeting for the September launch.

### 1.1 Audiences → views & permissions (summary; full RBAC in §2.3)

| Audience | Who | Primary need | Sees | Does NOT see |
|---|---|---|---|---|
| **Super-Admin** | Founders / lead eng | Everything; manage admins & config | All dashboards, raw drilldowns, per-user detail (pseudonymized), admin/audit log, admin management | (nothing withheld; but still no fund-movement — none exists) |
| **Ops / Internal** | Ops, growth, support eng | Run day-to-day; investigate | All dashboards, per-user drilldown, system health, audit log (read); whitelist invites, feature flags (non-custodial config) | Admin management, secret keys/config |
| **Stakeholder (read-only)** | Investors, advisors | Traction & trajectory | Curated KPI dashboards (growth, TVL, revenue, trajectory); aggregate only | Per-user drilldown, PII, raw ops/system internals, config controls, audit log |
| **Client (read-only)** | The client / partner | "Show me it working" | The **Stakeholder/Client Overview** (§3.7) — non-technical, graphical, narrative; revenue-forward | Everything operational/technical; per-user data; config |

**Each audience gets a different default landing screen and a different nav set** (role-scoped at the server, not just hidden in the UI). Stakeholder and Client views are *aggregate-only and pseudonymized by construction* — they cannot reach a per-user record even by URL guessing (server-side RBAC denies it, §2.3).

---

## 2. Access & security model

The admin panel is a **secret surface**: it must be hard to discover, hard to reach, separated from the user app, strongly authenticated, role-scoped, fully audited, rate-limited, and — restated — **read-only over funds**.

### 2.1 Separation & secrecy of the admin surface

Two acceptable shapes (decision in §6 / roadmap):

- **Option A — `(admin)` route group in `apps/web`** under an unguessable base path (e.g., `/_ops-<random-slug>/…`), gated at `middleware.ts` *before* any product code runs. Pros: reuses the data layer and component library directly. Cons: shares a deploy/origin with the user app (must be airtight at the edge).
- **Option B — separate app/deploy** (`apps/admin`, its own domain/subdomain like `ops.internal.sparkpoint.xyz`, ideally not publicly resolvable / behind the org VPN). Pros: hard network-level isolation, separate origin, separate secrets, blast-radius isolation from the user app. Cons: a little duplication (shared via `packages/shared` + a shared `ui` package).

> **Recommendation:** start with **Option A behind a strict allowlist + unguessable slug for the Sept launch (fastest, reuses everything), with Option B as the documented migration** once the panel is externally shown to stakeholders/clients regularly. Either way the admin routes are **excluded from sitemaps/robots, return 404 (not 403) to unauthenticated/un-allowlisted requests** (so the surface's existence isn't confirmable), and never link from the user app.

**Hard isolation rules regardless of option:**

- Admin routes share **no session/cookie** with the user app; different cookie name, domain scope, and signing secret.
- The admin BFF is a **distinct API namespace** with its own auth middleware; product/user endpoints are never reachable with an admin session and vice-versa.
- The admin surface reads from **read replicas / a reporting role** (DB user with `SELECT`-only grants on analytics views, no `INSERT/UPDATE/DELETE` on custody-relevant tables — see §4) — defense-in-depth so even a compromised admin process cannot mutate product state.

### 2.2 Authentication (SEPARATE from end-user wallet connect)

Admin auth is **not** wallet connect. End users prove control of an EOA to use *their* funds; admins prove *employment/authorization* to view *analytics*. Keeping these separate is a security property (an admin login can never be mistaken for, or escalate into, custody authority).

**Options (discussed; pick per §7):**

| Option | Mechanism | Pros | Cons | Fit |
|---|---|---|---|---|
| **SSO (recommended)** | Google Workspace / Okta / Auth0 OIDC restricted to the company domain, **2FA enforced at the IdP** (TOTP/WebAuthn) | No password management; central deprovisioning; hardware-key MFA; audit at IdP | Requires IdP setup | **Best for team + ongoing** |
| **Email + password + mandatory 2FA (TOTP/WebAuthn)** | Self-hosted auth (e.g., via a vetted lib) with a hard 2FA requirement | No external IdP dependency | We own credential security, reset flows | Acceptable fallback |
| **Admin allowlist** | Explicit allowlist of admin identities (email/SSO subject) — *required in addition to* SSO/email, never instead of | Simple, explicit membership; pairs with SSO | Not auth by itself | **Always-on layer** |
| **Magic-link** | Email magic link + 2FA | Low friction for read-only stakeholders/clients | Email-account security becomes the perimeter | Only for **read-only** Stakeholder/Client, time-boxed |

> **Recommended stack:** **SSO (company-domain OIDC) + enforced 2FA at the IdP + an explicit server-side admin allowlist mapping subject→role.** Read-only **Client/Stakeholder** access may be provisioned as **time-boxed, single-role magic-link or scoped SSO guest accounts** with 2FA, auto-expiring after the engagement/demo window. **No anonymous access; no shared logins** (every human has their own identity so the audit log is meaningful).

**Session hardening:** short session TTL with sliding refresh; absolute max session length; idle timeout; secure, `HttpOnly`, `SameSite=Strict` cookies; bind session to a device/UA fingerprint; **step-up re-auth (re-enter 2FA)** before viewing per-user drilldown or the admin/audit log.

### 2.3 Role-Based Access Control (RBAC)

Roles are enforced **server-side on every admin endpoint and every page load** (not by hiding UI). A role maps to an allowlist entry; the BFF derives capabilities from the role claim and denies anything outside it (default-deny).

| Role | Dashboards | Per-user drilldown (pseudonymized) | System/ops health | Admin/audit log | Non-custodial config (whitelist invites, feature flags) | Admin management (add/remove admins, set roles) |
|---|---|---|---|---|---|---|
| **Super-Admin** | All | ✅ (step-up) | ✅ | ✅ read | ✅ | ✅ |
| **Ops** | All | ✅ (step-up) | ✅ | ✅ read | ✅ | ❌ |
| **Stakeholder (read-only)** | Curated KPI set (Overview, TVL, Revenue, Stakeholder Overview) — **aggregate only** | ❌ (server-denied) | ❌ | ❌ | ❌ | ❌ |
| **Client (read-only)** | **Stakeholder/Client Overview only** (§3.7) | ❌ (server-denied) | ❌ | ❌ | ❌ | ❌ |

> **No role — none — can move, withdraw, or reallocate user funds, because no such capability exists in the system (§0).** "Admin management" and "config" are limited to *non-custodial* operational data (who is an admin, beta whitelist invites, feature flags, dashboard settings). Whitelist/geo state gate **app access only**, never the onchain withdraw escape hatch (data-model VR-W2) — and even those writes, if exposed, go through the **product's** existing governed path with their own audit, not a fund path.

### 2.4 Admin audit log (every admin action)

A dedicated, **append-only** admin audit trail records **every** admin action: login/logout, 2FA/step-up events, page/dashboard views of sensitive surfaces (per-user drilldown, audit-log views), every config change (whitelist invite, feature-flag toggle), every data export, role changes, and impersonation-free "viewed user X" reads. It is distinct from (but modeled like) the product's `audit_logs` (data-model §15.2): append-only, no `UPDATE`/`DELETE`, optional hash-chain for tamper-evidence.

Minimum fields per entry: `ts`, `admin_id`, `admin_role`, `action` (enum: `login`/`logout`/`2fa_pass`/`stepup_pass`/`view_dashboard`/`view_user_detail`/`export_csv`/`config_change`/`role_change`/`feature_flag_toggle`/`whitelist_invite`/`killswitch_status_viewed`), `subject` (table+id or dashboard name; **subject ids are pseudonymized** for user records), `ip`, `geo`, `user_agent`, `request_id`, `payload` (structured, **no PII beyond a pseudonymous id, no secrets, no keys**), `result` (`ok`/`denied`/`error`). The admin audit log is itself viewable (read) only by Super-Admin/Ops with step-up, and **its own views are logged** (meta-audit). A nightly job alerts on anomalies (e.g., bulk export, off-hours access, repeated `denied`).

### 2.5 Rate-limiting, IP/geo allowlist, and surface hardening

- **Geo/IP allowlist for the admin surface:** the admin origin is restricted at the **edge** to an **IP allowlist (office/VPN egress IPs)** and a **geo allowlist** (allowed countries only). Requests outside the allowlist get a **404** (not 403) so the surface is not discoverable. This is the admin analogue of the product's edge geo-fence (plan `middleware.ts`) but **stricter** (allowlist, not block-list) and it does **not** carve out any public route (there is no admin "escape hatch" — admin is never custody-critical, so it can be fully locked down, unlike the product's `/exit`).
- **Rate-limiting:** per-identity and per-IP rate limits on **login** (aggressive, with exponential backoff + lockout + alert on brute-force), on **per-user drilldown reads** (to deter scraping of the user base), on **exports**, and a global ceiling per session. 429 on breach; breaches are audited and alerted.
- **Other hardening:** strict CSP, no third-party analytics/trackers on the admin origin (no data leakage), no source maps in admin prod bundles, secrets only server-side, dependency-pinned, HTTPS-only + HSTS, and **PII minimization** — admin reads operate on **pseudonymized** user identifiers (e.g., `smart_account_address` truncated / an internal `user_ref`) by default, with full address reveal gated behind step-up + audit and **never** for Stakeholder/Client roles.

### 2.6 Non-custody guarantee — restated as an enforceable checklist

A reviewer MUST confirm all of the following before the panel ships (mirrors the rigor of the product's invariant checks):

- [ ] The admin BFF holds **no private key, no signer, no session-key, no mnemonic**, and imports no signing library.
- [ ] No admin endpoint returns calldata, a UserOp, a signed payload, or anything submit-able to a bundler/RPC for a **write**.
- [ ] The admin DB role is **`SELECT`-only** on analytics/reporting views; it has **no grant** that can `INSERT/UPDATE/DELETE` custody-relevant tables; non-custodial config writes (whitelist/flags) go through the **product's** governed, separately-audited path, not a raw admin DB write.
- [ ] The kill-switch surface is **read-only status display**; there is **no** pause/unpause control anywhere in the panel; pause remains a multisig action outside the panel.
- [ ] Admin auth is fully separate from user wallet-connect; an admin session grants **zero** authority over any user account or fund.
- [ ] Deleting the entire admin panel + BFF leaves **withdraw-always (N2) intact** (it was never on the custody path).

---

## 3. Dashboards & sections

All charts are **Recharts** (per stack + design system §"data-viz"); all financials use **tabular numerals**; the **risk palette** (3–5 steps) is reused wherever risk appears; **semantic green/red/amber** carry outcome/safety only; the **spark accent** is reserved for primary emphasis/AI presence and is *not* used for gains/loss/risk (design-system §1–2). Every chart specifies type, axes, and series. Every dashboard supports a **global time-range selector** (24h / 7d / 30d / 90d / YTD / all) and a **granularity** toggle (day/week/month) where applicable, plus an **export (CSV/PNG)** affordance (audited, role-gated).

> **Provability note (carried from Constitution III):** every onchain-derived figure shown (TVL, share price, flows, fees) is reconstructable from `onchain_events` + `price_snapshots`. Where a number is an estimate/projection (e.g., forecast, expected APY), it is **explicitly labeled as such** and visually differentiated (dashed series, "est." badge) — the admin panel never presents a projection as realized.

### 3.1 Overview / Home — north-star KPIs

The landing screen for Super-Admin/Ops (and the basis of the curated Stakeholder view). Answers "how are we doing, right now, at a glance."

**Stat cards (with sparklines + delta vs prior period):**

| KPI | Value | Sparkline (Recharts) | Delta |
|---|---|---|---|
| **TVL** (total value locked, all vaults + Aave positions, USDC-quote) | big number | `LineChart` mini, 30d | ▲/▼ % vs prior period (semantic color) |
| **Active users** (WAU by default; toggle DAU/MAU) | big number | `BarChart` mini, 30d | ▲/▼ % |
| **Cumulative revenue** (sum across all streams, all-time) | big number | `AreaChart` mini, cumulative | ▲ since launch |
| **MRR-equivalent** (normalized monthly recurring run-rate; see §3.5) | big number | `LineChart` mini, by month | ▲/▼ % MoM |

Plus secondary cards: **New users (period)**, **Net deposit flow (period)**, **Executions success rate**, **System status** (green/amber/red rollup from §3.6).

**Charts on Overview:**
- **Growth at a glance** — `ComposedChart`: X = date; left Y = TVL (`Area`); right Y = active users (`Line`); shared 30/90d range. One glance ties money to people.
- **Revenue snapshot** — small **stacked `AreaChart`** of cumulative revenue by stream (links into §3.5).
- **Activity heat** — `BarChart` of daily executions colored by success/fail (semantic).

**States:** loading = skeleton cards + shimmer sparklines; empty (pre-launch) = "No data yet — launches Sept" with zeroed cards; error = inline retry per card (one failing source never blanks the whole page).

### 3.2 User analytics

Who the users are and how they behave. **Pseudonymized by default; full reveal is step-up + audited; Stakeholder/Client cannot reach this section.**

**KPIs / stat cards:** Total users; New users (period); **DAU / WAU / MAU** (+ **DAU/MAU stickiness ratio**); onboarding completion rate; activation rate (% who deposit); churn (period).

**Charts:**
- **Signups over time** — `BarChart` (new users/day) + overlaid `Line` (cumulative users). X = date, Y-left = new, Y-right = cumulative.
- **DAU/WAU/MAU** — multi-series `LineChart`, three series, X = date.
- **Onboarding funnel & completion rate** — `FunnelChart` (or horizontal stacked `BarChart`) across the data-model `onboarding_state` lifecycle: `prospective → wallet_connected → account_ready → mandated → active`; each step shows count + step conversion %; the drop-off step is highlighted.
- **Retention cohorts** — **cohort heatmap** (grid: rows = signup-week cohort, cols = weeks-since-signup, cell color = % retained; risk-neutral sequential palette, not the risk palette). Implemented as a custom Recharts/`div`-grid heatmap (Recharts has no native heatmap — a styled grid of cells with a `Tooltip`).
- **Geography** — `BarChart` of users by `geo_region` (coarse region from edge geo-fence; informational, not a custody gate). (No precise geo/PII.)
- **Wallet types** — `PieChart`/`Donut` of connector mix (WalletConnect / Coinbase Wallet / injected), from connection metadata.
- **Risk-profile distribution** — `BarChart` (or donut) of `mandates.risk_tier` (`conservative`/`moderate`/`growth`) using the **risk palette**.

**Top users by TVL** — sortable `Table` (rank, pseudonymous ref, TVL, deposits, last active, # recommendations accepted), virtualized; export audited; reveal-address is step-up + audited.

**Per-user drilldown** (`/users/[ref]`, Super-Admin/Ops only, step-up) — a single-user observe-only profile assembled from existing tables:
- Header: pseudonymous ref, smart-account address (masked; reveal = step-up), onboarding state, risk tier, joined date, last active.
- **TVL over time** — `AreaChart` (this user's positions value, USDC-quote).
- **Deposits/withdrawals** — `BarChart` (diverging: deposits +, withdrawals −; semantic colors) from `vault_share_events` / Aave events.
- **Chat usage** — `BarChart` of messages/day; counts only (no message content shown to protect privacy — content is OFFCHAIN and sensitive; the drilldown shows *volume & outcomes*, not transcripts, unless a separate, explicitly-scoped support flow is later defined).
- **Recommendations** — `Table` of `recommendations` (title, rank, status: proposed/acted/blocked/executed, outcome label win/loss/flat) + acceptance rate stat.
- **Session keys** — `Table` of `session_keys` (status active/expired/revoked/exhausted, scope summary, caps, `spent` vs `cumulative_cap`, expiry) — **observe-only** (no revoke control; revoke is the *user's* onchain action).
- Strictly **read-only**; no action affects this user or their funds.

**States:** loading skeletons; empty cohort grid = "not enough data yet"; error per-widget; **no-permission** = Stakeholder/Client get a server-side 404 on this whole section.

### 3.3 Usage / product analytics

How the AI assistant and product mechanics perform. Sourced from `chat_messages`, `recommendations`, `intent_bundles`, `simulation_results`, `executions`, `session_keys`, `literacy_tip_impressions`, `audit_logs`.

**KPIs:** chat volume (messages/sessions per period); **recommendation acceptance rate**; **simulation pass rate**; **execution success rate**; session-key grants/revocations (period); literacy tip engagement (impression→expand rate).

**Charts:**
- **Chat volume & tool-step success** — `ComposedChart`: `Bar` = chat messages/day; `Line` = % of agent tool-steps that succeeded (from coordinator/agent telemetry). X = date.
- **Recommendation funnel** — horizontal stacked `BarChart` over the `recommendation_status` lifecycle: `proposed → acted_pending → (executed | blocked | abandoned | expired)`; surfaces **acceptance rate** and **policy-block rate**.
- **Simulation pass/fail** — stacked `BarChart` per day (`passed` vs `will_revert` vs `slippage-blocked`), from `simulation_results`.
- **Execution success/failure** — stacked `BarChart` (`confirmed` vs `reverted` vs `declined` vs `dropped`) from `executions.status`; + a `Line` of success-rate %.
- **Session-key grants vs revocations** — grouped `BarChart` over time (grants +, revocations −), from `session_keys` register/revoke events.
- **Literacy engagement** — `BarChart` of tip impressions by `trigger_context` + an expand-rate `Line`.
- **Feature adoption** — `BarChart` of % of active users who used each feature (chat, vault deposit, Aave supply, swap, session keys, outcomes view) in the period; trend `Line` per feature optional.

**States:** loading skeleton; empty = zeroed; error per widget.

### 3.4 TVL & vault analytics

The money view — onchain truth, reconstructable. Sourced from `vaults`, `vault_share_events`, `indexed_positions`, `onchain_events`, `price_snapshots`, plus DeFiLlama/subgraph cross-checks.

**KPIs:** Total TVL; per-vault TVL (one conservative vault at launch, designed for N vaults); **net flow (period)**; **cap utilization %** (TVL / `total_protocol_cap`); current **share price** and **trailing APY**; # depositors.

**Charts:**
- **Total & per-vault TVL over time** — stacked `AreaChart`: X = date, Y = TVL (USDC-quote), one stacked series per vault (single series at launch; stacking is future-proofed).
- **Deposits / withdrawals & NET FLOWS** — diverging `BarChart`: X = date; deposits as positive bars (semantic green), withdrawals as negative bars (semantic red); overlaid **net-flow `Line`** (cumulative or per-period). This is the heartbeat chart.
- **Caps utilization** — `RadialBarChart` or horizontal `BarChart` with a reference line at the cap: shows `total_protocol_cap` utilization and (aggregate) per-user-cap headroom; amber as utilization nears the cap.
- **Share price / APY history** — dual: `LineChart` of `share_price_ray` over time, and a separate `LineChart`/`AreaChart` of trailing APY (e.g., 7d/30d annualized from share-price growth). APY labeled "realized, net-of-everything" (0-fee at launch).
- **Withdraw-always drill status** — a **status panel** (not a chart): last successful **withdraw-always drill** timestamp/result (the quickstart drill: redeem with frontend+agents offline, while paused), the current **pause status** (read-only, from `KillSwitch`), and a green/red badge. This makes the N2 guarantee *observable* to stakeholders. **Status only — no controls.**

**States:** loading skeleton; empty (pre-deposit) = zeroed with "Vault live, no deposits yet"; error = per-widget retry with a "data source: RPC/subgraph" provenance note.

### 3.5 Revenue dashboard — **CENTRAL, make it rich**

> The centerpiece. This is where **revenue is shown in action, graphically** — the screen we show the client. It visualizes the streams from [`../revenue-model/README.md`](../revenue-model/README.md): **launch-era** = swap-routing fee (if/when enabled) + premium AI subscription tier; **future** = strategy-vault performance fees, optional thin management fee, SRK fee-share/buyback. Future streams render as **clearly-labeled projected/placeholder lanes** until the revenue-model §5.2 amendment makes them live; the dashboard distinguishes **realized** (solid) from **projected** (dashed + "est." badge) everywhere.

**Stream taxonomy the dashboard models (one color per stream, consistent across all charts):**

| Stream | Status at launch | Source |
|---|---|---|
| **Swap-routing fee** (Aerodrome swaps from chat) | Launch-era, ≤0.10–0.20% if enabled (likely 0) | onchain swap events / fee-recipient skim |
| **Premium AI subscription** | Launch-era (Phase-2 in revenue plan; modeled now) | Stripe-or-equivalent subscriptions |
| **Performance fee** (strategy vaults, realized yield, HWM) | **Future / projected** | onchain fee-share mint events (when live) |
| **Management fee** (≤0.25%, multi-strategy only) | **Future / projected** | onchain NAV-accrual (when live) |
| **SRK fee-share / buyback** | **Future / projected** | onchain buyback/distribution events (when live) |
| **Treasury float** (own capital) | Phase-0, non-user | own-position yield (informational) |

**KPIs / stat cards:** **Cumulative revenue** (all-time, all streams); **revenue this period**; **MRR-equivalent** and **ARR-equivalent**; **run-rate** (annualized current period); **revenue per active user (ARPU)**; **revenue per vault**; **blended take-rate** (revenue / relevant volume-or-TVL). Each card has a sparkline + delta.

**Charts (each fully specified):**

1. **Revenue by STREAM, stacked over time** — **stacked `BarChart`** (or stacked `AreaChart` for a smoother trend). **X = time** (period: day/week/month, via granularity toggle); **Y = revenue (USD)**; **one stacked series per stream** (swap fee, premium tier, [projected] perf fee, [projected] mgmt fee, [projected] SRK). Projected streams render with a dashed/hatched pattern + legend "(projected)". This is the hero chart — "where the money comes from, over time."
2. **Cumulative revenue** — **`AreaChart`**, monotonic; **X = time**, **Y = cumulative USD**, single area (optionally stacked by stream). Shows the all-time curve.
3. **Revenue trajectory / run-rate & simple forecast** — **`LineChart`** with two series: **realized** (solid) and **forecast** (dashed, "est."). **X = time** extending into the future; **Y = revenue (period or annualized run-rate)**. Forecast = a *simple, transparent* model (e.g., trailing-Nd average growth extrapolated, or run-rate held flat) — **clearly labeled as a naive projection, not a promise** (Constitution III). A `ReferenceLine` marks "today." Optional shaded confidence band (`Area` between low/high) labeled illustrative.
4. **MRR / ARR-equivalent over time** — **`LineChart`** (or `ComposedChart` with bars for monthly bookings + a line for MRR). **X = month**, **Y = USD**. MRR = subscription MRR + normalized recurring portion of fees (define the normalization in a tooltip/footnote). ARR = MRR × 12.
5. **Revenue per user / per vault** — **two `BarChart`s** (or a toggle): ARPU over time (`X = period`, `Y = USD/user`), and revenue-per-vault (`X = vault`, `Y = revenue`); at launch the latter is one bar (future-proofed).
6. **Fee-vs-TVL & take-rate** — **`ComposedChart`**: `Area` = TVL (context), `Line` = blended take-rate (revenue ÷ TVL, in bps) on a secondary axis. Tells the "are we extracting modestly?" story the revenue model cares about (restraint as a feature).
7. **Performance-fee high-water-mark status** — a **panel + small chart** (relevant once perf fees are live; placeholder until then): per-strategy-vault, show current **share price vs HWM** as a `LineChart` with the **HWM as a `ReferenceLine`**, and a status badge ("above HWM → fee accrues" / "below HWM → no fee, recovering"). Reinforces "we only earn when you earn."
8. **Top revenue-generating cohorts** — **horizontal `BarChart`**: revenue attributed by cohort (e.g., signup-month cohort, or risk-tier cohort, or top-vaults), `Y = cohort`, `X = revenue`. Helps see where revenue concentrates.

**Revenue history table** — a sortable, exportable `Table`: columns = period, revenue by stream (one col each), total, cumulative, MoM %, take-rate. Footer totals. Export is audited/role-gated. This is the "show me the numbers behind the charts" backstop.

**Take-rate & honesty framing:** the dashboard surfaces, near the hero chart, a one-line **"we only earn when you earn"** context (cumulative *user* yield vs cumulative *protocol* revenue side-by-side as two `Area`s) — so the revenue story is always shown against the value delivered to users, matching the revenue model's positioning and never leading with a projection.

**States:** loading = skeletons for cards + charts; **empty / pre-revenue** (the launch reality) = charts render with **zeroed realized lanes + visible projected lanes** and a clear banner: "Realized revenue begins post-amendment; projected lanes are illustrative, not forecasts of return"; error = per-widget retry with source provenance (Stripe vs onchain vs computed).

### 3.6 System / ops health

Is the machine healthy? Sourced from Sentry, the agent service telemetry, the deterministic policy layer's `audit_logs`, `data_source_health`, `indexer_cursors`, `risk_events`, and chain reads (`KillSwitch`, `CapRegistry`).

**KPIs / status tiles (green/amber/red):** Agent-service status (up/degraded/down); RPC/Alchemy health; indexer lag (blocks behind head); subgraph (Aave/Aerodrome) health; Dune/DeFiLlama freshness; Tenderly sim availability; Sentry error rate; **kill-switch status (read-only)**.

**Charts / panels:**
- **Agent-service status** — status tile + uptime `Line` (period); last incident.
- **Policy-engine decision counts & blocks** — stacked `BarChart` per day: `approved` vs `rejected`/`blocked_*` (by reason: simulation/cap/slippage/allowlist) from `intent_bundles.policy_verdict` / `audit_logs`. A high block-rate is a product signal, not just an error.
- **Simulation latency** — `LineChart` of p50/p95 Tenderly sim latency over time (multi-series).
- **Error rates (Sentry)** — `AreaChart` of errors/period, split by service (web / agent / indexer); `Line` overlay of error-rate %.
- **Guardrail triggers** — `BarChart` of `risk_events` by type (owner-mismatch, impl-change, cap-breach attempt, oracle staleness, large drawdown) — each is a defense-in-depth signal worth watching.
- **Kill-switch status** — **read-only status panel**: current pause state (`deposits_paused` from chain), who-can-pause (multisig address, linked to BaseScan), last change (from events). **No control. Display only.** A note states pause never blocks withdraw (N2) and is governed by the multisig, not this panel.
- **RPC / indexer health** — table + sparkline per source from `data_source_health` (liveness, staleness, last block) and `indexer_cursors` (lag, reorg watermark); amber/red on degradation; ties to the "no execution on stale data" guarantee.

**States:** loading skeleton; healthy empty (no incidents) = green "all systems nominal"; error = the health page must itself degrade gracefully (if Sentry is down, show "monitoring source unavailable," not a blank).

### 3.7 Stakeholder / Client Overview

A **curated, non-technical, mostly-graphical, presentation-grade** summary — the default (and only) landing for the **Client** role, and the headline view for **Stakeholders**. Designed to be screen-shared in a meeting. No jargon, no per-user data, no system internals, no config — **aggregate, polished, narrative**.

**Layout (top to bottom, story order):**
1. **Headline KPI band** — four big stat cards with sparklines: **TVL**, **Total users**, **Cumulative revenue**, **Run-rate (ARR-equivalent)** — each with a friendly delta ("▲ 18% this month").
2. **Growth** — `ComposedChart`: TVL `Area` + active-users `Line` over 90d. "Money and people, together."
3. **Revenue trajectory** — the §3.5 **trajectory chart** (realized solid + forecast dashed, labeled illustrative) — the centerpiece for the client. Plus the cumulative-revenue `AreaChart`.
4. **"We only earn when you earn"** — the user-yield vs protocol-revenue dual-area, reinforcing the trust thesis (a *positioning* asset per the revenue model).
5. **TVL & flows** — a simplified net-flows `BarChart` (deposits up / withdrawals down) — proof of real, sticky money.
6. **Trust badges** — small status row: **non-custodial ✓** (read-only over funds), **withdraw-always: last drill passed ✓**, **0-fee conservative vault ✓**, **kill-switch: multisig-governed, status shown ✓**. (Reads from the same status sources; all observe-only.)

Everything here is **derived from the richer dashboards** (same data, simplified presentation) so there is one source of truth. **Tone:** confident, plain-language, honest — *no projection is shown without an "illustrative" label* (Constitution III). This view is **export-to-PDF/PNG** friendly for leave-behinds (audited export).

**States:** loading = branded skeleton; pre-launch/empty = a "launching September" hero with zeroed-but-styled cards (so a demo never looks broken); error = graceful per-widget fallback.

---

## 4. Data sources & pipeline

Every metric maps to a source. The admin panel **reuses the existing four-layer data layer** (plan Layer 4) — it adds **no new custody path** and reads from the same Postgres/pgvector index, onchain reads, and external sources, plus subscriptions/billing for the premium tier.

| Dashboard / metric | Source(s) | Real-time vs batched | Notes |
|---|---|---|---|
| TVL (total/per-vault), share price, caps utilization | **onchain via Alchemy RPC** (`totalAssets`, `convertToAssets`, `CapRegistry`) + **`vaults`/`indexed_positions` mirror** + **Aave/Aerodrome subgraphs** + **DeFiLlama** (cross-check) | near-real-time (cached 30–60s) for live tiles; **materialized** daily series for history | Authority order RPC > subgraph > Dune > DeFiLlama (data-model VR-DS1). Display-only; never a gate. |
| Deposits/withdrawals, net flows | **`vault_share_events`** + **`onchain_events`** (indexer) | batched by the indexer (confirmation-lag safe); series materialized | Reconstructable from chain (data-model §18). |
| Users (total/new/active, DAU/WAU/MAU), onboarding funnel, cohorts, geography, wallet types, risk distribution | **Postgres app DB**: `users`, `mandates`, `chat_messages`, connection metadata, `beta_whitelist` (geo) | batched/materialized (hourly–daily rollups); active-user counts can be near-real-time | PII-minimized; geo is coarse region only. |
| Per-user drilldown (TVL, deposits/withdrawals, chat usage, recs accepted, session keys) | join of `indexed_positions`, `vault_share_events`, `chat_messages` (counts), `recommendations`, `outcome_logs`, `session_keys` | mostly batched; on-demand fresh reads when opened | Step-up gated; pseudonymized. |
| Usage/product (chat volume, tool-step success, rec acceptance, sim pass/fail, exec success, session-key churn, literacy, feature adoption) | `chat_messages`, `recommendations`, `intent_bundles`, `simulation_results`, `executions`, `session_keys`, `literacy_tip_impressions`, agent/coordinator telemetry | batched rollups; some near-real-time counters | Tool-step success from agent service logs/metrics. |
| **Revenue — swap fee** | **onchain swap/fee-recipient events** (Alchemy/subgraph) | batched (indexer) | Realized, onchain-verifiable. |
| **Revenue — premium AI subscription** | **Stripe (or equivalent) API/webhooks** | webhooks → near-real-time; nightly reconcile | The MRR/subscription source. Store normalized in app DB. |
| **Revenue — perf fee / mgmt fee / SRK** (future) | **onchain fee-share mint / NAV-accrual / buyback events** | batched (indexer) when live | Projected/placeholder until §5.2 amendment + contracts live. |
| MRR/ARR, run-rate, forecast, take-rate, ARPU, cohorts | **computed** in the BFF/materialized views over the above | batched (scheduled recompute) + cached | Forecast = simple, labeled model; not stored as truth. |
| Treasury float (informational) | own-position onchain reads | batched | Non-user; clearly labeled. |
| System health (errors, latency) | **Sentry** (errors, performance), **agent-service metrics**, **Tenderly** (sim availability) | near-real-time | Sentry API/ingest. |
| Policy decisions / blocks, guardrail triggers | **`audit_logs`**, **`intent_bundles`**, **`risk_events`** | batched + near-real-time counters | Reuses the product's append-only audit + risk tables. |
| RPC/indexer/source health | **`data_source_health`**, **`indexer_cursors`**, **Dune** freshness | near-real-time | Drives the green/amber/red tiles. |
| Kill-switch status | **onchain `KillSwitch`/`Guardian` reads** | near-real-time | **Read-only.** |

**Pipeline shape & caching:**
- **Read replica / reporting role:** admin reads hit a **read replica** (or at minimum a `SELECT`-only reporting DB role over analytics views) so admin load never touches the product's hot path and cannot mutate state (§2.1).
- **Materialized views / rollup tables** for all historical time-series (daily/weekly TVL, revenue, users, flows), recomputed on a schedule (e.g., every 5–15 min for recent, nightly for full history) — charts read pre-aggregated rows, not raw events, for speed.
- **Caching:** a Redis (or equivalent) read-through cache for hot tiles (live TVL, active-user counts, system status) with short TTLs (30–120s); chart series cached behind the materialized views. The admin BFF sets cache headers; no admin data is cached at a CDN/edge (secrecy + freshness).
- **Real-time vs batched, explicitly:** *near-real-time* = live KPI tiles, system status, subscription webhooks, kill-switch status; *batched/materialized* = all historical time-series, cohorts, funnels, revenue history, per-user aggregates. Forecasts/derived metrics are recomputed on the rollup schedule.
- **Provenance:** every chart can show its source + freshness ("RPC, 42s ago" / "Stripe, live" / "materialized, 03:00") so admins trust the number — and projected/estimated values are always flagged.

---

## 5. Screen inventory

Admin is **desktop-first** (data-dense, intended for large screens / screen-share); **tablet-responsive** (charts reflow to single column, tables scroll horizontally); phone is a **degraded read-only** courtesy view (KPI cards + the Stakeholder Overview only — heavy tables/heatmaps collapse to "best viewed on desktop"). Reuses the design-system tokens, dark-first, tabular numerals, risk palette (design-handover §04).

| # | Screen / route (under the secret base path) | Audience | Purpose | Key states |
|---|---|---|---|---|
| A0 | `/login` | all admins | SSO/2FA entry | default, 2FA-challenge, error, locked-out (rate-limited), denied |
| A1 | `/` Overview/Home | Super-Admin, Ops (curated for Stakeholder) | North-star KPIs | loading, empty (pre-launch), error, partial-source-error |
| A2 | `/users` User analytics | Super-Admin, Ops | User KPIs, funnel, cohorts | loading, empty, error, **no-permission (404 for Stakeholder/Client)** |
| A3 | `/users/[ref]` Per-user drilldown | Super-Admin, Ops (step-up) | Observe one user | loading, empty, error, no-permission, **step-up-required** |
| A4 | `/usage` Usage/product analytics | Super-Admin, Ops | AI & product mechanics | loading, empty, error, no-permission |
| A5 | `/tvl` TVL & vault analytics | Super-Admin, Ops, Stakeholder | The money view | loading, empty (no deposits), error |
| A6 | `/revenue` **Revenue dashboard** | Super-Admin, Ops, Stakeholder | Central revenue view | loading, **empty/pre-revenue (projected lanes + banner)**, error, partial-source-error |
| A7 | `/system` System/ops health | Super-Admin, Ops | Health & guardrails | loading, healthy-empty, error (monitoring-source-down), no-permission |
| A8 | `/overview` Stakeholder/Client Overview | Stakeholder, Client (default), Super-Admin/Ops (preview) | Curated narrative | loading, empty (launching-Sept hero), error, export-mode |
| A9 | `/admin/users` Admin management | Super-Admin | Manage admins/roles | loading, error, no-permission |
| A10 | `/admin/config` Non-custodial config (whitelist invites, feature flags) | Super-Admin, Ops | Operational config (no fund path) | loading, error, no-permission, confirm-change (audited) |
| A11 | `/admin/audit` Admin audit log | Super-Admin, Ops (step-up) | Forensics | loading, empty, error, step-up-required, no-permission |

**Global, every screen:** top bar (env badge: prod/staging, current admin + role, sign-out), left nav (role-scoped), global time-range + granularity selectors, export affordance (where allowed, audited), a persistent **"observe-only / non-custodial"** marker so it's always clear the panel cannot touch funds.

**State conventions (consistent across screens):**
- **Loading** — skeletons (cards, chart frames) + shimmer; never a blank flash.
- **Empty** — purposeful copy + zeroed-but-styled visuals (so pre-launch demos look intentional, not broken).
- **Error** — **per-widget** inline error + retry + source/provenance; one failing source never blanks a whole page.
- **No-permission** — **server-side 404** for sections a role can't see (secrecy: don't confirm existence); within-page, hide rather than disable controls a role lacks.

---

## 6. Tech approach

- **Surface:** **`(admin)` route group in `apps/web`** behind an unguessable base path + edge allowlist for the Sept launch (Option A, §2.1), with a clear migration path to a **separate `apps/admin` deploy** (Option B) once the panel is shown externally on a recurring basis. Either way: distinct origin/cookie/secret, excluded from robots/sitemaps, 404 to outsiders.
- **UI:** **Next.js (App Router)** + **TailwindCSS** + **shadcn/ui** (Card, Table, Tabs, Badge, Dialog/Drawer, Alert, Progress, Tooltip) + **Recharts** for all charts — **reusing the existing design system** (dark-first, spark accent reserved, semantic + risk palettes, tabular numerals; design-handover §04). Server Components for static shells + request-time aggregates; small `'use client'` islands only for interactive charts/filters. A shared `packages/ui` (or direct reuse of `apps/web/components`) keeps the admin and product look consistent.
- **Admin API / BFF (strictly read-only over funds):** a dedicated admin API namespace (Next.js route handlers / a thin service) that:
  - authenticates the admin session (separate from user wallet-connect), enforces **RBAC + step-up** on every endpoint (default-deny), and writes the **admin audit log** on every action;
  - reads **only** from the read replica / `SELECT`-only reporting role + materialized views, plus external read APIs (Sentry, Stripe read, Dune, DeFiLlama) and **read-only chain RPC**;
  - **holds no keys, builds no transactions, exposes no signable/submittable endpoint** — the §2.6 checklist is a hard gate;
  - the *only* "writes" it may proxy are **non-custodial operational config** (whitelist invites, feature flags) routed through the **product's existing governed path** (with the product's own audit), never a raw fund-adjacent write — and these are absent from Stakeholder/Client roles entirely.
- **Auth/session:** OIDC SSO (company domain) + enforced 2FA + server-side allowlist→role mapping; short-TTL, `HttpOnly`/`SameSite=Strict`, device-bound sessions; step-up re-auth for sensitive reads (§2.2).
- **Reuse of the data layer:** the BFF queries the **same Postgres index** (via replica/reporting role) and the **same onchain/subgraph/Dune/DeFiLlama sources** the product already uses (plan Layer 4) — plus **Sentry** (health) and **Stripe-or-equivalent** (subscriptions). Historical series come from **materialized rollups**; hot tiles from a short-TTL cache. No new custody-critical infrastructure is introduced.
- **Edge/perimeter:** IP + geo allowlist at the edge (404 outside); rate-limiting on login/drilldown/export; strict CSP, no third-party trackers, no admin source maps in prod.

---

## 7. Roadmap & delivery

**Spec Kit:** this plan should be **formalized as a Spec Kit feature, `specs/002-admin-panel/`** (spec → plan → tasks via the `speckit-*` flow), so it goes through the same constitution-checked, spec-driven path as the product. The non-custody guarantee (§0) and the RBAC/audit model (§2) become explicit acceptance criteria there; the revenue dashboard's "no projection-as-truth / no fee authorized here" rules tie back to the revenue-model §5.2 amendment.

### Ships for the September launch (minimal but *real*)

A genuinely useful, demoable admin + **revenue** dashboard for the client — small surface, real data:

- **Access/security:** secret base path + edge IP/geo allowlist + SSO/2FA + server-side allowlist→role; the four roles (Super-Admin/Ops/Stakeholder/Client) with server-side enforcement; the **admin audit log**; rate-limiting; the **§2.6 non-custody checklist signed off**.
- **Dashboards (launch set):**
  - **Overview/Home** (north-star KPIs + sparklines) — §3.1.
  - **TVL & vault analytics** (TVL, deposits/withdrawals/net flows, caps, share price/APY, withdraw-always drill + kill-switch *status*) — §3.4.
  - **Revenue dashboard** — §3.5, the centerpiece: revenue-by-stream stacked, cumulative, trajectory/forecast (labeled illustrative), MRR/ARR-equivalent, history table, take-rate, "we only earn when you earn." At launch most realized lanes are zero (Phase-0 reality) with **projected lanes + premium-tier (Stripe) live if enabled** — so the *graphical revenue story* is real and presentable even before fees are amended in.
  - **Stakeholder/Client Overview** — §3.7, the curated screen we show the client.
  - **Basic User analytics** (totals, new/active, signups, onboarding funnel) and **basic System health** (status tiles, error rate, kill-switch status) — enough to run the beta.
- **Data:** materialized rollups for TVL/revenue/users/flows; Stripe (or equivalent) wired for subscriptions; Sentry wired for health; onchain reads for TVL/caps/kill-switch.

### Later (post-launch)

- Full **User analytics** (retention cohort heatmaps, geography, wallet-type mix, risk distribution) and **per-user drilldown** with step-up.
- Full **Usage/product analytics** (tool-step success, sim pass/fail breakdowns, feature-adoption matrix, literacy engagement).
- Full **System/ops health** (policy-decision breakdowns, sim-latency p50/p95, guardrail-trigger analytics, RPC/indexer health detail).
- **Revenue depth:** performance-fee **HWM** panels, management-fee & **SRK fee-share/buyback** lanes (activated when the revenue-model §5.2 amendment + contracts ship), top revenue cohorts, fee-vs-TVL deep-dive, per-vault revenue (as vaults multiply).
- **Surface migration** to a separate `apps/admin` deploy (Option B) once shown externally on a recurring basis.
- **Exports/leave-behinds** (PDF/PNG of the Stakeholder Overview), scheduled email digests, and anomaly alerting on the admin audit log.

---

## Appendix — Quick mapping: metric → data-model source

| Metric | Data-model table(s) (data-model.md §) |
|---|---|
| TVL, share price, caps, pause status | `vaults` (§8), `indexed_positions` (§6), `KillSwitch`/`CapRegistry` chain reads |
| Deposits/withdrawals, net flows | `vault_share_events` (§9), `onchain_events` (§16) |
| Users, onboarding funnel, geography | `users` (§3, `onboarding_state` lifecycle §3.1), `beta_whitelist` (§15.1) |
| Risk distribution | `mandates.risk_tier` (§5) |
| Recommendations & acceptance | `recommendations` (§7, lifecycle §7.1), `outcome_logs` (§13) |
| Simulation pass/fail | `simulation_results` (§12) |
| Execution success/failure | `executions` (§11, lifecycle §11.1), `intent_bundles` (§11) |
| Session keys grants/revocations | `session_keys` (§10, lifecycle §10.1) |
| Chat usage, literacy | `chat_messages` (§16), `literacy_tip_impressions` (§14) |
| Policy decisions / blocks, guardrail triggers | `audit_logs` (§15.2), `intent_bundles.policy_verdict` (§11), `risk_events` (§16) |
| Source/indexer health | `data_source_health`, `indexer_cursors` (§16) |
| Revenue (swap/premium/perf/mgmt/SRK) | onchain fee events + Stripe-or-equivalent + computed rollups (revenue-model §3) |

> **Final reminder:** every figure above is **observed, never actuated**. The admin panel watches SparkPoint; it cannot touch a single unit of user funds. The lone privileged surface — the kill-switch — is **status-display-only**, with the action governed by the existing pause-only multisig, outside this panel.
