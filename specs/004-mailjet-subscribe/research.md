# Phase 0 Research — Mailjet newsletter subscribe

How to make the landing's "Get launch updates" form actually capture emails into Mailjet, on a gated, server-rendered Next 16 landing, without exposing secrets.

## Recon of the supplied widget

The operator supplied the Mailjet **subscription widget** embed (iframe + `pas-nc-embedded-v2.js`). Fetching the widget form (`https://14ij2.mjt.lu/wgt/14ij2/0r1n/form?c=9f6f03a5`) shows:

- It submits via **`fetch` + `FormData`** to **`https://14ij2.mjt.lu/wgt/14ij2/0r1n/subscribe?c=22cd210c`** (note: the *subscribe* token `c=22cd210c` differs from the *form* token `c=9f6f03a5`).
- Fields: **`email`** (type=email, required) and **`consent`** (type=checkbox, `required`).
- It is a **public** endpoint — the widget is meant to be embedded on any site; **no API key/secret** is involved. Mailjet applies the list's **double opt-in** (sends a confirmation email; contact stays pending until confirmed).

## Options considered

| Option | Brand UX | Secrets | CORS | Confirms result | Verdict |
|---|---|---|---|---|---|
| **Server proxy → public widget endpoint** | keeps our form | none | none (server→server) | yes (reads upstream status) | **CHOSEN** |
| Embed the Mailjet iframe widget as-is | ❌ breaks the New Era footer design | none | n/a | n/a | Rejected (FR-008 — visual design must be preserved) |
| Client `fetch` straight to `mjt.lu` | keeps our form | none | ❌ likely CORS-blocked (or opaque `no-cors`, can't read success) | no | Rejected |
| Mailjet **API** (`node-mailjet`, list-add) | keeps our form | ❌ needs `MJ_APIKEY`+`MJ_SECRET` | none | yes | Rejected for now (the operator supplied the *widget*, not keys; adds a secret + a dep for no extra benefit at this stage) |

**Decision:** a thin **Next Route Handler** `app/api/subscribe/route.ts` that validates the email and POSTs it (form-encoded `email` + `consent`) to the widget's public subscribe endpoint, server-side.

**Rationale:** keeps the exact custom form (FR-008); needs **no secret** (FR-007); avoids browser CORS to `mjt.lu`; returns a **real** success/error to the form (FR-003/005); inherits Mailjet's **double opt-in** (FR-002). It also leaves a single, obvious seam to swap in the Mailjet API later (if richer control is ever needed) without touching the client.

## Open implementation detail (resolve during implement)

- **Exact upstream payload**: the widget's `consent` checkbox contributes its value when checked (HTML default `"on"`). The route will send `consent` set to the value the widget uses; confirm by inspecting the widget JS / a single test POST and asserting an upstream 2xx + that a pending contact appears in Mailjet. Use `application/x-www-form-urlencoded` (or `FormData`) to match the widget.
- **Upstream success signal**: treat an upstream 2xx as success; map an "already subscribed" response to success-like (FR-009). Verify the exact body shape with one controlled test submit.

## Verification stance

Test the route empirically (curl `/api/subscribe` with valid/invalid/duplicate emails against `next start`), verify the gate-ON case (the POST is allow-listed, not 307'd), and confirm a real submit produces a **pending** Mailjet contact + a confirmation email. See `quickstart.md`.
