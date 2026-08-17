# Feature Specification: Applying for alpha access without connecting a wallet

**Feature Branch**: `045-public-access-application`

**Created**: 2026-08-17

**Status**: Implemented

**Input**: "We have a whitelist form 'This wallet isn't in the alpha yet' only when a user attempts to
connect wallet but their wallet address is not whitelisted (`/verify`). But we don't have a form in
the actual `alpha.sparkpoint.io`. Can we have another apply-for-whitelist in there that requires no
connect wallet to apply? They just have to put their wallet address manually in the form."

## The problem, stated precisely

Feature 026 built an alpha access application. It works. Almost nobody who needs it can reach it.

To see that form a visitor must, in order: install a wallet, connect it, sign a SIWE message, be
resolved against `wallet_allowlist`, come back `beta: false`, and be redirected to `/verify` — where
they are told **"This wallet isn't in the alpha yet"** and finally offered the form.

Every one of those steps is a filter, and the person the form exists for fails the first one. Someone
who has read about Sparky and wants in has no reason to install and connect a wallet to a product
they cannot use, and connecting solely to be refused is a dead end with extra steps. The application
form was reachable only through the wall it exists to ask about.

Meanwhile the page every visitor actually lands on — the public landing at `/` — offered exactly two
things: a newsletter subscribe, and a **Connect wallet** button that, for anyone not already
allowlisted, leads to that same refusal.

## Scope

**In:** a public, session-free application form on the landing page and at `/apply`; the endpoint
behind it; provenance on the stored record; the admin queue showing that provenance.

**Out:** changing who gets approved, changing how approval works, any automated approval, any change
to `/verify`'s existing signed-in form, and anything touching the custody path.

## Requirements

### FR-045-001 — The form asks for the address instead of proving it

Four fields: wallet address, contact handle, name or alias, reason. The address is validated as
`0x` + 40 hex, case-insensitively (a visitor pasting a checksummed address from a block explorer, or
typing one by hand, must not be rejected over capitalisation), and the zero and burn addresses are
refused. The other three mirror 026's caps exactly — 200 / 120 / 2000 — because both forms feed the
same table, the same server-side caps and the same DB CHECKs, and a form that accepts more than the
server does is lying to its user.

### FR-045-002 — The record must say whether anyone proved the address

`access_applications.source` is `'wallet'` for a session-filed application and `'public'` for one
typed into this form. The admin review queue renders a `public` row with an
**"unverified · public form"** tag beside the address.

This is the single most consequential field on the row and the one a reviewer cannot recover any
other way. Approving adds the address to `beta`; if it arrived through this form, the person who
typed it may not control it, and the person who does may never have asked for anything. A queue that
renders both kinds identically asks for a decision without the facts. `'wallet'` is the default
because that is the honest description of every pre-045 row, not because it is a convenient
placeholder.

A signed-in re-submit **upgrades** a `public` row to `wallet` — the applicant has now proven it. The
reverse never happens: FR-045-004 makes it structurally impossible.

### FR-045-003 — One response for every outcome

`POST /access/public-application` returns an identical body and status whether the application is
new, a duplicate, or for an address that is already approved and allowlisted.

The caller is anonymous. Any difference between those cases is an oracle for *"has this address
applied / does this address have access"*, answerable by anyone with a list of addresses — and this
endpoint is not entitled to answer it. The store returns a `created` boolean so the server can audit
the difference; the API drops it.

### FR-045-004 — An existing application is never modified

The insert is `ON CONFLICT (address) DO NOTHING`, not an upsert.

Anyone can type anyone's address here. A write that could touch an existing row would let a stranger
overwrite a real applicant's contact details — replacing how we reach the person whose address it
is. First application wins. The dropped attempt is still written to `access_application_audit` with
`source='public'`, which is the only place a repeat submission is visible at all.

### FR-045-005 — Rate limiting, because the session used to be the throttle

Every other write surface in this app sits behind a SIWE session, and that session *was* the rate
limit: you cannot spam a form you must sign a message to reach. This one removes it.

3 per hour per IP, plus a 120/hour global ceiling. Sliding-window, in-process, bounded key space.
Deliberately best-effort and documented as such — it is not a security boundary, and the boundaries
that matter do not depend on it (the endpoint grants nothing, cannot modify an existing row, and
every field is length-capped in the DB). It exists so that filling the human review queue with junk
is not trivially cheap.

Two properties are load-bearing and tested: a **rejected** attempt is not recorded (otherwise a
caller already over the limit keeps pushing their own window forward and can never recover — a
throttle silently becoming a ban), and the key space is capped (the key is an attacker-controlled
`X-Forwarded-For`, so an unbounded map is itself the amplification).

A honeypot field is accepted, dropped, and reported as success. Telling a bot it was detected is
free tuition.

### FR-045-005a — ⚠️ Whether the per-visitor limit works at all is a MEASURED fact, not a code fact

`alpha.sparkpoint.io` is served `client → openresty (DigitalOcean) → tailscale → Coolify proxy →
container`. The socket address this process sees is never the visitor's, so the limit depends
entirely on a header surviving three hops that each independently choose to append, overwrite, or
drop it. Confirmed from the live response headers: `Server: openresty`, and **no `cf-ray`** — alpha
does not sit behind Cloudflare, so `CF-Connecting-IP` will not be present there and everything rests
on `X-Forwarded-For`. (The prod client domain does terminate at Cloudflare, which is why
`cf-connecting-ip` is preferred when present: Cloudflare overwrites it, so it cannot be forged.)

**The failure mode is silent and looks exactly like success from inside the process.** If the chain
loses the visitor's address and the last hop substitutes its own, every request arrives carrying a
well-formed `X-Forwarded-For` holding the *same* value — so all visitors share one bucket, and the
**fourth applicant on the entire internet** is refused with "too many applications from this
connection" having never submitted one. The form would appear to work and quietly accept almost
nobody.

Two things follow, and the second is the one that matters:

- The `source: "none"` guard (skip the per-visitor limit when no header exists) is kept because it
  is correct and free — but it is **not** coverage. Measured against `next start`: **Next.js injects
  `x-forwarded-for` itself** from the socket peer when absent, so `"none"` never fires under this
  runtime, and the constant-value case is invisible to it. No single request carries a signal that
  separates "one person applying four times" from "four people sharing a bucket".
- Therefore this **must be measured against the deployment** (the 044 lesson: a thing can be
  published, deployed, and broken for every anonymous visitor with nothing failing). See
  *Post-deploy measurement* below. `ACCESS_APPLY_PER_IP_LIMIT=0` disables the per-visitor limit
  without a code change; `ACCESS_APPLY_GLOBAL_LIMIT` tunes the ceiling that always applies.

Develop/alpha is a **single** `sparkpoint-web` instance (COOLIFY.md — no secondary, no LB), so the
in-process counter sees every request. If alpha is ever moved to the prod primary+secondary+`ip_hash`
topology, each replica counts independently and the effective ceiling doubles.

### Post-deploy measurement — ✅ RUN 2026-08-17 against live alpha

Rate limiting runs **before** body parsing, so an invalid body consumes a token and stores nothing —
these probes create no applications.

| probe | result | what it establishes |
|---|---|---|
| `POST {}` ×5, no proxy headers | `400, 400, 429, 429, 429` | The per-visitor limiter is **live** and keyed on something stable for this caller. |
| `POST {}` with `x-forwarded-for: 203.0.113.31` | `400` | A caller-supplied `X-Forwarded-For` **reaches the app at position 0** — the chain APPENDS rather than overwriting. |
| same, `...32` | `400` | A second supplied value gets a second bucket, confirming the key is that header. |
| same, `cf-connecting-ip: 203.0.113.41` | `400` | ⚠️ The Cloudflare header also arrived intact — see below. |

**Verdict: the per-visitor limit works for ordinary visitors.** Because the chain appends, the first
hop inserts the true peer address at position 0 for any client that sends no header of its own — so
an ordinary browser is keyed on its real address and two visitors get two buckets. The catastrophic
shared-bucket case (which would have refused the fourth applicant on the internet) **does not apply
here**. `3/hour` stands and `ACCESS_APPLY_PER_IP_LIMIT` stays at its default.

**⚠️ And the probe found a real weakness, now fixed.** `cf-connecting-ip` was preferred *first* and
arrived intact — but alpha is not behind Cloudflare, so nothing overwrites it, meaning the
highest-priority rate-limit key was entirely attacker-chosen and a fresh value per request walked
straight past the per-visitor limit. It is now gated behind **`ACCESS_APPLY_TRUST_CF_HEADER=true`**,
default off. Turn it on **only** on a domain that genuinely terminates at Cloudflare (the prod client
domain), where the overwrite is what makes the header evidence.

`X-Forwarded-For` remains spoofable in the same way, and that is accepted rather than fixed: unlike
the Cloudflare header it has no better alternative and is correct for honest traffic, and the
**120/hour global ceiling** is what bounds a determined caller. The per-visitor limit bounds the
casual one — which was always its stated job.

**Re-run this probe if the proxy chain changes** (a new front door, Cloudflare added or removed, or
alpha moved to the prod primary+secondary+`ip_hash` topology).

### FR-045-006 — Public under BOTH middleware gates

`/apply` and `/api/access/apply` are listed in `ALLOW_EXACT` (Gate 1, the `SITE_LOCKED` construction
lock) and `/apply` in `PUBLIC_EXACT` (Gate 2, the access gate develop runs).

The landing page is served on a locked deploy, and it now carries the form — so the endpoint it posts
to must be served there too, or the form renders, submits, and receives a 307 to `/coming-soon` that
the client reads as a failure. Gate 1 has **no `/api` prefix** by design; only exact matches survive
it. Listing one gate and not the other is exactly how `/allocations/` shipped broken in 044:
published, deployed, and 307'd for every anonymous fetch, with nothing failing.

`publicPaths.test.ts` asserts both paths against both gates by parsing the middleware source, because
a unit test of the app cannot see a redirect that happens above it.

### FR-045-007 — Authentication and identity are separate decisions

The agent's `RequestContextMiddleware` demands the s2s bearer **and** the §1.2 `X-Account` /
`X-Owner` / `X-Chain-Id` scoping headers for every non-exempt path. This route has a caller (the web
tier) but no user.

`NO_ACCOUNT_PATHS` skips the identity parse for this one path while authentication stays mandatory —
it is an internal surface, not an internet-facing one. Requiring the headers would have forced the
web tier to invent an identity, most obviously by echoing the address typed into the form, and a
fabricated `X-Owner` is far worse than an absent one: every route downstream treats that header as
verified. `request.state.account` is left unset, so `get_account` raises for anything that needs a
user, and a route can only end up here deliberately.

### FR-045-008 — Applying grants nothing

Approval remains exactly `AllowlistStore.add(address, 'beta')`, audit-logged identically to a manual
add. The table stays a record, never an authority. Nothing here is on the custody path: `/exit`,
`/trust` and the on-chain withdraw are never gated by any of it (N2).

## Non-goals, and why

- **No email verification or address ownership challenge.** Both reintroduce the friction the feature
  exists to remove. The mitigation is honesty at review time (FR-045-002), not a second gate.
- **No status lookup for a public applicant.** "Is my application approved?" is the same question as
  "does this address have access", and answering it for an anonymous caller is FR-045-003's oracle.
  The applicant hears back on the contact they gave.
- **No auto-approval.** An unverified address must not be able to grant itself anything.

## What was built

| Layer | Path |
|---|---|
| Schema | `services/agent/migrations/0036_access_application_source.sql` |
| Store | `services/agent/src/sparkpoint_agent/db/access_applications.py` (`submit_public`) |
| Route | `services/agent/src/sparkpoint_agent/api/access.py` (`POST /access/public-application`) |
| Auth seam | `services/agent/src/sparkpoint_agent/api/security.py` (`NO_ACCOUNT_PATHS`) + `api/middleware.py` |
| Public BFF | `apps/web/src/app/api/access/apply/route.ts` |
| Rate limiter | `apps/web/src/lib/access/rateLimit.ts` |
| Form model | `apps/web/src/lib/access/publicApplicationForm.ts` |
| Form | `apps/web/src/components/access/PublicAccessApplicationForm.tsx` + `apply-form.css` |
| Surfaces | `apps/web/src/app/apply/page.tsx`, `components/screens/landing/NewEraLanding.tsx` (closing section + hero CTA) |
| Gates | `apps/web/middleware.ts` |
| Admin | `apps/web/src/components/admin/AllowlistPanel.tsx` (`SourceTag`) |

## Verification performed

- Agent suite **1553 passed**; ruff and mypy clean.
- Web suite **646 passed**; eslint and both typecheck configs clean; production build clean.
- **Real Postgres** (throwaway container, 0029 then 0036): migration applies and is idempotent on
  re-run; the actual store SQL was exercised — public insert marks `source='public'`, a second public
  submit changes nothing, a public submit cannot overwrite a wallet-signed row, a signed-in
  re-submit upgrades provenance, approval survives a later public submit, every submit is audited
  including the dropped duplicates, and the DB length CHECKs fire independently of the API.
- **End-to-end through the built app** against a recording stub agent: valid submissions forward with
  the s2s bearer and **no** identity header or cookie; a honeypot submission returns success and
  never reaches the agent; malformed address and short reason return 400 with actionable messages;
  the per-IP limit cuts in at exactly 3 with a `Retry-After`, and a different IP is unaffected.
- **Both deploy shapes.** `SITE_LOCKED=true`: `/`, `/apply` and `/api/access/apply` serve 200 while
  `/verify`, `/connect` and `/api/agent/*` correctly 307 to `/coming-soon`. `SITE_LOCKED=false`:
  everything reachable anonymously.
- **Browser**, headless Chromium: `/apply` in light, dark and at 390px; validation messages; the
  landing form submitted end to end to the success state; the landing's closing panel stays legible
  in dark mode (it is a permanently-white section, so the form pins that palette rather than
  following the theme).
- A React #418 hydration warning appears on the landing in dark mode. It was **reproduced on
  untouched `HEAD`** by swapping the pristine landing files back in and rebuilding — it is the
  pre-existing theme `useState` initializer reading `localStorage`, not this feature.

## Deployment

1. Apply `0036_access_application_source.sql` with `PGCLIENTENCODING=UTF8` (order-insensitive, but
   apply first so the form works the moment it appears).
2. Redeploy the agent, then the web app.
3. No new environment variables. The route reuses `AGENT_INTERNAL_URL` + `AGENT_S2S_TOKEN`; with
   either unset it returns an honest 503 rather than silently swallowing applications.
