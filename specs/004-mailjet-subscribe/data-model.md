# Phase 1 Data Model — Mailjet newsletter subscribe

This feature introduces **no app-side persistence**. Mailjet is the system of record. The only "data" is the in-flight request/response between the form, our route, and Mailjet, plus the client form state.

## Entities

### Subscriber (owned by Mailjet — not stored by this app)
| Field | Type | Notes |
|---|---|---|
| email | string (email) | the subscriber's address; the only field we collect |
| consent | boolean | required by the widget; conveyed on submit |
| status | enum | `pending` (after submit, before they click the confirmation email) → `confirmed` (double opt-in). Managed entirely by Mailjet. |

The app never reads, lists, or stores subscribers; it only **adds** one via the widget endpoint.

## Form state (client, ephemeral)
| State | Meaning | UI |
|---|---|---|
| `idle` | default | email input + Subscribe button |
| `submitting` | request in flight | control disabled / loading; blocks double-submit |
| `success` | upstream accepted | "Thanks — check your inbox to confirm" message replaces the input |
| `error` | validation or provider failure | inline friendly error; **input preserved**; retry enabled |

## Transport shapes (see contracts/subscribe-contract.md)
- **Client → `/api/subscribe`**: `{ "email": string }` (JSON).
- **`/api/subscribe` → client**: `{ "ok": true }` or `{ "ok": false, "error": "invalid_email" | "provider" }`.
- **`/api/subscribe` → Mailjet**: form-encoded `email` + `consent` to `MAILJET_WIDGET_SUBSCRIBE_URL`.

## Validation rules
- `email` MUST be non-empty and match a basic email shape, validated **client-side** (pre-submit, FR-004) **and** **server-side** (defense-in-depth) before any upstream call.
- No other fields are accepted from the client (the upstream URL + consent flag are server-controlled — no SSRF / no client-supplied destination).
