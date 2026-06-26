# Quickstart — verify the landing-only gate

Run + validate the gate. All commands from `apps/web/`.

## Static gates (both states)

```bash
npx tsc --noEmit      # must pass
npx eslint .          # must pass
npx next build        # must pass; route table still lists all ~37 routes
```

## Gate ON — request matrix (the important one)

Build and serve with the gate locked, then probe every request shape:

```bash
SITE_LOCKED=true NEXT_PUBLIC_SITE_LOCKED=true npx next build
SITE_LOCKED=true npx next start -p 3000 &     # serve the locked build

# 1) Landing + assets MUST be reachable (expect 200)
curl -s -o /dev/null -w "%{http_code} /\n"             http://localhost:3000/
curl -s -o /dev/null -w "%{http_code} favicon\n"        http://localhost:3000/favicon.ico
curl -s -o /dev/null -w "%{http_code} coming-soon\n"    http://localhost:3000/coming-soon
# (load / in a browser: the Three.js canvas renders, Geist fonts load — not the .rm fallback)

# 2) Gated routes MUST redirect (expect 307 -> /coming-soon), with NO app content
for p in /chat /portfolio /vault /strategies /trust /admin /admin/killswitch \
         /connect /onboarding /verify /confirm/x /portfolio/123 /settings /does-not-exist; do
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}  $p\n" "http://localhost:3000$p"
done

# 3) RSC / prefetch / segment shapes MUST also redirect (no flight payload leak)
curl -s -D - -o /dev/null -H 'RSC: 1'                         http://localhost:3000/admin | grep -i '^location\|^HTTP'
curl -s -D - -o /dev/null -H 'Next-Router-Prefetch: 1'        http://localhost:3000/chat  | grep -i '^location\|^HTTP'
curl -s -o /dev/null -w "%{http_code}  /chat.rsc\n"           http://localhost:3000/chat.rsc
curl -s -o /dev/null -w "%{http_code}  rsc-query\n"           'http://localhost:3000/admin?_rsc=abc'

kill %1
```

**Pass criteria:** group 1 → `200`; groups 2 & 3 → `307` to `…/coming-soon` and **no** rendered screen text / `text/x-component` flight body returned for any gated path.

## Gate OFF — baseline smoke (no regression)

```bash
SITE_LOCKED=false NEXT_PUBLIC_SITE_LOCKED=false npx next build
SITE_LOCKED=false npx next start -p 3001 &
for p in / /chat /vault /admin /connect /confirm/x; do
  curl -s -o /dev/null -w "%{http_code}  $p\n" "http://localhost:3001$p"   # all 200, full app
done
kill %1
```

## Fail-closed check

```bash
# SITE_LOCKED entirely unset on a "public" build must behave as LOCKED:
unset SITE_LOCKED; npx next build && npx next start -p 3002 &
curl -s -o /dev/null -w "%{http_code} %{redirect_url}  /admin (expect 307)\n" http://localhost:3002/admin
kill %1
```

## Maps to success criteria

- Group 1 → **SC-002** (landing fidelity), **I-3**
- Groups 2 & 3 → **SC-001** (100% of non-landing routes gated), **I-2**
- Gate-OFF smoke → **SC-005**, **I-4**
- Fail-closed check → **SC-004**, **I-1**
- CTA (manual, in browser with the locked build) → **SC-006**, FR-008
