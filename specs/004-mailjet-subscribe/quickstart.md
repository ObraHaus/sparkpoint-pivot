# Quickstart — verify the Mailjet subscribe flow

All commands from `apps/web/`.

## Static gates
```bash
npx tsc --noEmit      # pass
npx eslint .          # pass
npx next build        # pass; /api/subscribe shows as a route (ƒ)
```

## Route behavior (gate OFF — easiest to drive)
```bash
SITE_LOCKED=false npx next build && SITE_LOCKED=false npx next start -p 3330 &
# valid email → 200 {ok:true}; a real (pending) contact appears in Mailjet + a confirmation email is sent
curl -s -X POST localhost:3330/api/subscribe -H 'Content-Type: application/json' \
  -d '{"email":"sparkpoint-test+launch@example.com"}' -w "\n%{http_code}\n"
# invalid email → 400 {ok:false,"error":"invalid_email"}
curl -s -X POST localhost:3330/api/subscribe -H 'Content-Type: application/json' -d '{"email":"nope"}' -w "\n%{http_code}\n"
# wrong method → 405
curl -s -o /dev/null -w "%{http_code}\n" localhost:3330/api/subscribe
```
> Use a **test inbox you control** for the valid case (it triggers a real Mailjet double-opt-in email). Confirm in the Mailjet dashboard that the contact is **pending**.

## Gate ON — subscribe must still work (FR-006)
```bash
SITE_LOCKED=true npx next build && SITE_LOCKED=true npx next start -p 3331 &
# landing only, BUT /api/subscribe is allow-listed:
curl -s -o /dev/null -w "/ = %{http_code}\n"            localhost:3331/
curl -s -o /dev/null -w "/admin = %{http_code}\n"        localhost:3331/admin            # 307 -> /coming-soon
curl -s -X POST localhost:3331/api/subscribe -H 'Content-Type: application/json' \
  -d '{"email":"sparkpoint-test+gated@example.com"}' -w "\n/api/subscribe = %{http_code} (expect 200, NOT 307)\n"
```

## Form states (browser, gate OFF)
Load `/`, scroll to "05 — Fully self-custodial":
- submit empty/garbage → inline validation, no request.
- submit a valid email → button shows submitting, then the "check your inbox" success message.
- (simulate offline / point `MAILJET_WIDGET_SUBSCRIBE_URL` at a bad host) → friendly error, email preserved, retry works.

## Maps to success criteria
- Valid submit + Mailjet pending contact → **SC-001**, I-4
- All four outcomes deterministic → **SC-002**, I-4
- Gate-ON subscribe 200 → **SC-003**, I-5
- `grep -ri MJ_APIKEY\|MJ_SECRET apps/web/src` empty + no secret in `/api/subscribe` response → **SC-004**, I-1
- Visual diff limited to state text + microcopy → **SC-005**
