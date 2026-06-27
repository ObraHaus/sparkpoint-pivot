# Feature Specification: Mailjet newsletter subscribe

**Feature Branch**: `004-mailjet-subscribe` (git: `feat/mailjet-subscribe`)

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "Integrate Mailjet with the landing's newsletter subscribe form so submitted emails are actually captured — keep the existing custom form, add the email to our Mailjet list with double opt-in, show clear states, use the public Mailjet subscription widget (no API keys), and keep it working on the gated landing."

## Context

The landing's "05 — Fully self-custodial" section has a "Get launch updates" email form (feature `003`'s landing polish). Today its submit only flips a **local** "thanks" message — no email is captured anywhere, so launch-interest signups are silently lost. This feature makes the form **actually subscribe** the visitor to SparkPoint's email list via **Mailjet**, with Mailjet's standard double opt-in, while keeping the form's existing look and the under-construction gate intact.

> **Out of scope:** changing the form's visual design; building an email-marketing/CRM backend or list-management UI; storing subscribers anywhere other than Mailjet; sending the campaigns themselves; any authentication. Mailjet is the system of record for subscribers.

## Clarifications

### Session 2026-06-26

- Q: How is the email captured — Mailjet API (keys) or the public subscription widget? → A: The **public Mailjet subscription widget** (account/list `14ij2`, form `0r1n`). No Mailjet API key or secret is used or stored; the widget's public subscribe endpoint handles list-add + double opt-in.
- Q: Single opt-in or double? → A: **Double opt-in** — the subscriber receives a Mailjet confirmation email and is "pending" until they confirm. (This is the widget's configured behavior.)
- Q: Consent capture? → A: **Implied consent on submit** with visible microcopy near the form ("We'll only email launch updates. Unsubscribe anytime."). The widget requires a consent flag, which the submit supplies. (An explicit checkbox is a possible future tightening but is not required for this launch form.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A visitor subscribes successfully (Priority: P1) 🎯 MVP

A visitor on the landing enters their email in "Get launch updates" and submits. The form shows progress, then a confirmation that they've been added and should check their inbox to confirm. Mailjet records the email (pending double-opt-in).

**Why this priority**: This is the entire point — actually capture launch-interest emails instead of losing them. Independently demoable end-to-end.

**Independent Test**: Submit a valid email on the landing; confirm the form shows a success state telling the user to check their inbox, and the email appears in the Mailjet list as a pending contact (and a Mailjet confirmation email is sent).

**Acceptance Scenarios**:

1. **Given** the landing's subscribe form, **When** a visitor enters a valid email and submits, **Then** the form shows a submitting state, then a success state instructing them to confirm via the email Mailjet sends, and the email is added to the Mailjet list.
2. **Given** a successful submit, **When** the visitor checks their inbox, **Then** they receive Mailjet's double-opt-in confirmation email; the contact remains pending until they confirm.
3. **Given** an email already on the list, **When** it is submitted again, **Then** the visitor sees a graceful success/"already subscribed" outcome (no error, no duplicate harm).

---

### User Story 2 - Clear feedback on every outcome (Priority: P1)

The visitor always knows what happened — invalid input, a network/provider hiccup, or success — and can recover without losing their input.

**Why this priority**: A signup form that fails silently or ambiguously loses the very leads it exists to capture, and erodes trust on a public page. Core to the feature.

**Independent Test**: Submit an invalid email, then simulate a provider/network failure; confirm each shows a distinct, friendly message and the email is never silently dropped, with the ability to retry.

**Acceptance Scenarios**:

1. **Given** the form, **When** the visitor submits an empty or malformed email, **Then** an inline validation message appears and nothing is sent.
2. **Given** a valid email, **When** the subscribe request fails (network or provider error), **Then** a friendly error appears with a way to retry, and the entered email is preserved.
3. **Given** any submit, **When** it is in progress, **Then** the control is disabled/loading so the visitor can't double-submit.

---

### User Story 3 - Works on the gated landing (Priority: P2)

While the site is under construction (landing-only gate on), the subscribe form still works for the public.

**Why this priority**: The form lives on the only public page during the construction phase; if the gate blocked the subscribe path, the feature would be dead on arrival. Important but a constraint on US1 rather than a separate journey.

**Independent Test**: With the construction gate ON, submit the form on the public landing and confirm the subscribe succeeds (not redirected to the coming-soon page).

**Acceptance Scenarios**:

1. **Given** the construction gate is ON, **When** a visitor submits the subscribe form, **Then** the request is processed (not gated to `/coming-soon`) and the success/error states behave exactly as ungated.

### Edge Cases

- **Invalid / empty email** → inline validation, no request sent.
- **Network or provider failure / timeout** → friendly error, input preserved, retry available; never a silent drop.
- **Already-subscribed email** → graceful success-like outcome.
- **Double-submit / rapid clicks** → in-flight control is disabled; at most one request.
- **Construction gate ON** → the subscribe path is reachable (allow-listed), unlike the rest of the app.
- **No secret exposure** → no Mailjet API key/secret in the client bundle, repo, or network responses.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On submit of a valid email, the system MUST add that email to SparkPoint's Mailjet subscription list.
- **FR-002**: The subscription MUST use Mailjet's **double opt-in** — the visitor receives Mailjet's confirmation email and remains pending until they confirm.
- **FR-003**: The form MUST present distinct states: **idle**, **submitting**, **success**, and **error**.
- **FR-004**: Malformed or empty email input MUST be caught client-side and shown as an inline validation message, with no request sent.
- **FR-005**: A network/provider failure MUST surface a friendly, retryable error and MUST NOT silently discard the email (the entered value is preserved).
- **FR-006**: The subscribe path MUST remain reachable when the construction gate is ON (the gate MUST NOT redirect it to the coming-soon page).
- **FR-007**: The integration MUST use the **public** Mailjet subscription widget (list `14ij2`, form `0r1n`); no Mailjet API key or secret may be required, committed, or shipped to the client.
- **FR-008**: The form's existing **visual design MUST be preserved** — this feature changes behavior only (plus optional small consent microcopy).
- **FR-009**: An already-subscribed email MUST be handled gracefully (success-like, no error or duplicate side effects).
- **FR-010**: The visitor MUST consent to receiving emails; consent is conveyed on submit with visible microcopy (the widget's required consent flag is satisfied by the submit).
- **FR-011**: The success state MUST tell the visitor to **check their inbox to confirm** (so the double-opt-in step isn't a dead end).

### Key Entities

- **Subscriber**: an email address plus consent and a subscription status (pending → confirmed), all owned and stored by **Mailjet**, not by this app.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A submitted valid email appears in the Mailjet list as a **pending (double-opt-in)** contact, and a Mailjet confirmation email is sent — verified in Mailjet.
- **SC-002**: **100%** of submit attempts end in a clear, correct state (success **or** an actionable error) — no ambiguous or dead UI, confirmed across valid, invalid, duplicate, and failure cases.
- **SC-003**: The subscribe flow succeeds on the **gated** public landing (verified on the live gated URL), behaving identically to the ungated case.
- **SC-004**: **No Mailjet secret** appears in the repository, the client bundle, or any client-visible network payload (only the public widget identifiers).
- **SC-005**: The form's appearance is **unchanged** vs. before this feature (visual diff limited to the new state text + optional consent microcopy).

## Assumptions

- The **public Mailjet subscription widget** (`14ij2` / `0r1n`), with double opt-in, is the capture mechanism and the source of truth; no app-side datastore is added.
- **Consent** is conveyed by the act of submitting plus microcopy; an explicit consent checkbox is a possible later tightening, not required now.
- Mailjet sends and manages the **confirmation email** and unsubscribe handling; this feature does not send email itself.
- The construction gate (feature `003`) is the only thing that could block the subscribe path; it will allow-list the subscribe route.
- Network egress from the deployment to Mailjet's public subscribe endpoint is permitted.
