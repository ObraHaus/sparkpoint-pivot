# Gate Contract — Landing-only construction gate

The authoritative behavioral contract for the gate. Tasks and the verification matrix trace to this.

## Configuration keys

| Key | Scope | Read where | Default (unset) | Purpose |
|---|---|---|---|---|
| `SITE_LOCKED` | server / build | `middleware.ts` (Edge) | **locked** (fail-closed) | The real gate. `"false"` (case-insensitive) = open; **anything else, including unset = locked**. |
| `NEXT_PUBLIC_SITE_LOCKED` | client / build-inlined | `NewEraLanding.tsx` | not locked (cosmetic only) | CTA mirror so the landing's Connect button doesn't dead-end. Cosmetic only — never the security boundary. |

Both must be set in each deployment's **build** environment (Next inlines them for Edge middleware / client bundles at build; Coolify injects per-app env at build).

### Per-environment matrix

| Environment | `SITE_LOCKED` | `NEXT_PUBLIC_SITE_LOCKED` | Result |
|---|---|---|---|
| Local dev (`apps/web/.env.local`) | `false` | `false` | full app |
| Coolify **develop** app | `false` | `false` | full app (team/client preview) |
| Public **main** app | `true` | `true` | **landing only** |
| Launch day | set both `false`, redeploy | — | full app live |

## Allow-list (public when locked)

Requests are matched on `request.nextUrl.pathname`.

- **Exact:** `/`, `/coming-soon`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`
- **Prefix:** `/_next/static`, `/_next/image`

Everything not in the allow-list is **gated**.

## Gated behavior (when locked)

- Response: **HTTP 307 redirect** to `/coming-soon`.
- Header: `x-robots-tag: noindex, nofollow`.
- Applies uniformly to: full-page HTML requests, RSC/prefetch requests (`RSC: 1` / `Next-Router-Prefetch` header, `?_rsc=` query), and `.rsc` / `.segment.rsc` suffixed paths — because all share the gated `pathname` and the gate never special-cases those headers/suffixes.

## Open behavior (when not locked)

- `middleware.ts` returns `NextResponse.next()` for all paths. Behavior is identical to the pre-feature app (no redirects, no Coming soon).

## Matcher (cost guard, not the security boundary)

`config.matcher` skips middleware for true static infra **by prefix** so the landing's chunks/fonts always load:

```
matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
```

It MUST NOT exclude paths by file-extension (that would let `/chat.rsc` skip the gate). The in-code allow-list is the source of truth; the matcher is only a performance guard.

## `/coming-soon` page contract

- App Router server component; imports **no** gated app components, providers, or Three.js.
- `export const metadata = { robots: { index: false, follow: false }, title: "SparkPoint — Coming soon" }`.
- Brand-consistent minimal content + a link back to `/`.
- Is itself allow-listed (so the redirect target never loops).

## `robots.ts` contract

- When locked: `rules: { userAgent: "*", allow: "/", disallow: "/" }`-style output that permits only `/` and disallows the rest; no sitemap of gated routes.
- When open: permissive (or default) — does not block the app.

## Landing CTA contract

- When `NEXT_PUBLIC_SITE_LOCKED` is truthy: `goConnect()` MUST NOT navigate to `/connect`; it routes to `/coming-soon` (and/or the button is relabeled/hidden). When falsy: unchanged (`/connect`).

## Invariants

- **I-1 Fail-closed:** unset/garbage `SITE_LOCKED` on a public deploy ⇒ locked.
- **I-2 Default-deny:** unknown/dynamic/new routes are gated unless explicitly allow-listed.
- **I-3 Landing fidelity:** with the gate ON, `/` and all its assets return 200; the landing renders fully.
- **I-4 No-op when open:** with the gate OFF, no route is redirected or altered.
- **I-5 Content scope:** no existing screen's content/layout/copy is modified by this feature.
