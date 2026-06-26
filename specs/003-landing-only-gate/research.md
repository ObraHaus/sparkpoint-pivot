# Phase 0 Research — Landing-only construction gate

How to expose only `/` publicly while keeping the rest of `apps/web` reachable on `develop`, on a server-rendered Next.js 16 App Router app (Nixpacks `next build` → `next start`, **not** a static export).

## Surface audit (what must stay public vs. be gated)

From an audit of `apps/web/src/app/page.tsx`, the landing component (`NewEraLanding.tsx`) and its CSS, the root layout, and `public/`:

- **Must stay public (allow-list):**
  - `/` — the landing (exact match; a prefix match on `/` would leak everything).
  - `/_next/static/*` — build chunks, page CSS, the **lazy Three.js chunks** (`await import('three')` + postprocessing addons fetched after first paint), and the self-hosted **Geist `woff2` fonts under `/_next/static/media`**. Blocking any of these degrades or breaks the landing.
  - `/_next/image` — the image optimizer endpoint (harmless to allow; landing uses no `next/image`, but `/connect` does for team preview).
  - `/favicon.ico` — served from `src/app/favicon.ico`.
  - `/robots.txt`, `/sitemap.xml` — crawler files (none today; allow-listed defensively).
- **Gate (everything else):** `/connect`, `/onboarding`, `/verify`; the whole `(app)` group at its un-grouped URLs (`/chat`, `/portfolio`, `/vault`, `/strategies`, `/trust`, `/automation`, `/bridge`, `/fees`, `/premium`, `/learn`, `/outcomes`, `/srk`, `/settings`, `/notifications`, `/confirm/[intent]`, `/portfolio/[positionId]`); all `/admin/*`.

**Key finding:** the landing is **asset-light** — it references zero `public/` images (every graphic is inline SVG or CSS), and fonts/JS all live under `/_next/static`. So allow-listing `/` + `/_next/static` + favicon is sufficient for full landing fidelity.

## Options considered

| Option | Enforcement | Reversible? | Deploy fit (Coolify, prod TBD) | Verdict |
|---|---|---|---|---|
| **Next `middleware.ts` allow-list, env-toggled** | Server (edge), before render | Flip one env var | Excellent — needs only `next start`, which we have; per-app env in Coolify | **CHOSEN** (best fit, lowest effort, true reversibility) |
| Basic Auth in middleware | Server (edge) | Flip env var | Excellent + portable | Viable runner-up; password UX worse than a public landing + Coming soon page. Same file/mechanism, so easy to switch to later if a team-preview password is wanted on the public box |
| Reverse-proxy / nginx allow-list | Server (proxy) | Edit proxy config | Poor — the Coolify nginx LB doesn't exist yet and won't follow to client prod; config lives outside the repo | Rejected (infra not present; not portable) |
| Separate landing-only build / static export | Build-time | Structural undo | Poor — two artifacts/domains; full app can't be statically exported; contradicts "team previews the same app on develop" | Rejected (over-engineered; YAGNI) |
| Client-side / layout guard | Client (or per-route) | Easy | Fine mechanically | Rejected — **not a security boundary**: ships gated HTML/RSC/code; misses a route easily |

Decision drivers: server-side enforcement (spec FR-004), config-only per-environment toggle (FR-005), and Simplicity/YAGNI (Principle VII) for a temporary curtain.

## Adversarial review — failure modes folded into the design

A bypass-hunt against the chosen approach surfaced two **fail-open** traps and several correctness traps. The design in `plan.md` mitigates each:

1. **Edge env inlining → fail OPEN.** Next inlines `process.env` for Edge middleware at **build** time. If `SITE_LOCKED` is only a *runtime* dashboard value (absent at build), it reads `undefined` and a naive `=== 'true'` check makes the gate a no-op → the whole app goes public. **Mitigations:** (a) read **fail-closed** (`!== 'false'`); (b) ensure Coolify injects `SITE_LOCKED` into each app's **build** env.
2. **RSC payload leak.** App Router has no `/_next/data/*` path; gated pages stream their content as **same-pathname** requests carrying `RSC: 1` / `Next-Router-Prefetch`, and as `.rsc` / Next-16 `.segment.rsc` suffixed paths (`_full.segment.rsc` is byte-identical to the full page RSC). **Mitigation:** gate strictly on `pathname`; never allow-list by the RSC header/query; never treat `.rsc`/`.segment.rsc` as static assets (the matcher excludes static infra by **prefix**, not by file extension).
3. **Denylist misses dynamic/unknown routes.** Enumerating gated segments misses `/confirm/[intent]`, `/portfolio/[positionId]`, casing/trailing-slash/encoded variants, and any new route. **Mitigation:** strict **allow-list** of `/` + assets; everything else denied by default.
4. **Over-narrow asset allow-list breaks the landing.** Allowing only `/_next/static/chunks` (forgetting `/_next/static/media`) drops the Geist fonts; blocking lazy chunks forces the no-WebGL `.rm` fallback. **Mitigation:** allow the whole `/_next/static` prefix + `/_next/image`.
5. **Rewrite vs redirect.** Rewriting an RSC request to `/` hands the router the wrong flight (client error/loop). **Mitigation:** `307` **redirect** to `/coming-soon`.
6. **CTA dead-end.** The landing's only internal link is `router.push('/connect')` (gated). **Mitigation:** `NEXT_PUBLIC_SITE_LOCKED` mirror reroutes/relabels the CTA when locked.

**Accepted residual (per clarification):** `/_next/static` must stay public for the landing, so compiled **client code** of gated screens remains fetchable from chunk files — a navigation gate is not a code-confidentiality gate. Accepted for a curtain over mock data; "fully absent from the public build" is a separate future feature if ever required.

## Verification stance

The matcher/regex must be verified **empirically**, not by reading it. `quickstart.md` defines a request-level matrix (`curl` every gated route + its `.rsc`/header/segment-prefetch shapes against `next start` with `SITE_LOCKED=true`) plus an OFF-state smoke and the `tsc`/`eslint`/`build` gates.
