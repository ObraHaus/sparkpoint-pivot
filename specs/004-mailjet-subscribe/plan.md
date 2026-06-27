# Implementation Plan: Mailjet newsletter subscribe

**Branch**: `004-mailjet-subscribe` (git: `feat/mailjet-subscribe`) | **Date**: 2026-06-26 | **Spec**: ./spec.md

**Input**: Feature specification from `specs/004-mailjet-subscribe/spec.md`

## Summary

Wire the landing's existing "Get launch updates" form to **Mailjet** so emails are actually captured (double opt-in). A thin **Next Route Handler** `app/api/subscribe/route.ts` (the app's first API route) validates the email and **server-side** POSTs it to the **public** Mailjet subscription-widget endpoint — no API keys, no browser CORS to `mjt.lu`, and a real success/error returned to the form. `NewEraLanding.tsx` gains a submit→fetch state machine (idle / submitting / success / error). The construction gate allow-lists `/api/subscribe`. Mailjet is the system of record; no app-side datastore.

## Technical Context

**Language/Version**: TypeScript 5 · Node 22 · React 19

**Primary Dependencies**: Next 16 App Router **Route Handler** (new — first API route) + native `fetch`. **No new packages** (no `node-mailjet` SDK — the public widget endpoint needs none).

**Storage**: None. Mailjet owns the subscriber record; the app persists nothing.

**Testing**: `tsc --noEmit` + `eslint` + `next build`; a request-level test of `/api/subscribe` (valid / invalid / duplicate / upstream-failure) against `next start`, plus a manual form-state check; Playwright smoke on the develop environment per playbook §3.7.

**Target Platform**: Server-rendered (`next start`) on the two replicas behind the nginx LB.

**Project Type**: Web frontend + one thin server route.

**Constraints**: no Mailjet secret in the repo, client bundle, or client-visible payload; the subscribe path MUST be reachable under the construction gate; the form's **visual design is unchanged**; keep `tsc`/`eslint`/`build` green.

**Scale/Scope**: 1 new route, 1 form wiring, 1 middleware allow-list entry, 1 env var doc, + SDD artifacts.

## Constitution Check

*GATE: Must pass before Phase 0. Re-checked after Phase 1.*

| Principle (constitution v1.2.0) | Assessment |
|---|---|
| I. Non-Custodial by Construction | **PASS / N/A** — no funds, keys, vault, or chain path; a newsletter form. |
| II. AI proposes, deterministic policy + user disposes | **PASS / N/A** — no AI and no execution path. |
| III. Provable, not promised | **PASS** — uses **double opt-in**: the user explicitly confirms via Mailjet; the success copy is honest ("check your inbox"). |
| IV. Security & bounded blast radius | **PASS** — the proxy targets a **fixed, non-user-controlled** public URL (no SSRF surface); input is validated; no secret handled; a failure is contained (clear error, input preserved). |
| V. Conservative, transparent launch | **PASS** — captures launch interest; nothing financial, no projections. |
| VI. Spec-Driven Development | **PASS** — built via this speckit lifecycle (specify → clarify → plan → tasks → analyze → implement). |
| VII. Simplicity & YAGNI | **PASS** — the minimal mechanism: a thin proxy to the public widget. No API keys, no SDK, no datastore, no CRM. Heavier options rejected in `research.md`. |

**Playbook §12 note:** obrahaus-governor centralizes **AI/SMS**; **email** (a Mailjet newsletter) is neither, and this client product owns its own marketing infra (sanctioned client divergence — see CLAUDE.md), so calling Mailjet directly is appropriate.

**Gate result: PASS** — no violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/004-mailjet-subscribe/
├── spec.md
├── plan.md                 # This file
├── research.md             # Phase 0 — integration approach decision
├── data-model.md           # Phase 1 — subscriber + the request/response shapes
├── contracts/
│   └── subscribe-contract.md   # Phase 1 — /api/subscribe + the upstream widget POST
├── quickstart.md           # Phase 1 — run + verify the subscribe flow
├── checklists/requirements.md
└── tasks.md                # Phase 2 (/speckit-tasks)
```

### Source Code (apps/web)

```text
apps/web/
├── src/app/api/subscribe/route.ts                      # NEW — POST handler: validate → proxy to Mailjet widget
├── middleware.ts                                       # EDIT — allow-list "/api/subscribe" through the gate
├── src/components/screens/landing/NewEraLanding.tsx    # EDIT — submit→fetch state machine + consent microcopy
├── src/components/screens/landing/new-era.css          # EDIT (minor) — state message styling (reuse .fsub-done)
└── .env.example                                        # DOC — MAILJET_WIDGET_SUBSCRIBE_URL
```

**Structure Decision**: Single Next app. The integration is a **thin server route + form wiring**. The server-side proxy is chosen so the browser never calls `mjt.lu` cross-origin (CORS), the form gets a real success/error (not an opaque `no-cors` response), and there is one obvious place to evolve to the Mailjet API later without touching the client.

## Architecture (how the design satisfies the spec)

1. **Form state machine (FR-003/004/005/011).** `NewEraLanding` makes the email input controlled and tracks `status: idle | submitting | success | error`. On submit: client-validate the email (FR-004); `POST { email }` to `/api/subscribe`; show submitting (disable control — covers the double-submit edge case); on `{ok:true}` show the success / "check your inbox" copy (FR-011); on failure show a friendly, retryable error and **keep the entered email** (FR-005). Visual design unchanged — reuse the `.fsub` / `.fbtn` classes (FR-008).
2. **Server proxy (FR-001/002/007/009).** `app/api/subscribe/route.ts` revalidates the email, then POSTs form-encoded `email` + the widget's required `consent` flag to `MAILJET_WIDGET_SUBSCRIBE_URL` (default = the public `…/wgt/14ij2/0r1n/subscribe?c=22cd210c`). Maps an upstream success → `{ok:true}`; an already-subscribed response → success-like (FR-009); anything else → `{ok:false, error}` with a 4xx/5xx. No secret is read or returned (FR-007).
3. **Gate allow-list (FR-006).** `middleware.ts` adds `"/api/subscribe"` to the allow-list so the POST isn't 307'd to `/coming-soon` while the gate is on.
4. **Consent + double opt-in (FR-002/010).** The proxy supplies the widget's required consent flag; microcopy near the form conveys it. Mailjet sends the confirmation email and manages pending→confirmed and unsubscribes.

## Complexity Tracking

> No constitution violations — not required.
