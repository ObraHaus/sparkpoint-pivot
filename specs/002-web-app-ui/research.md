# Research — Phase 0 (002-web-app-ui)

Porting decisions for recreating the approved design (`docs/design-handover/showcase/`) faithfully in `apps/web`. The prior scaffold's mistake was **re-deriving** the UI; every decision here favors **porting** the design's own assets so the result matches by construction.

## D1 — Visual system: port `app.css` globally (don't rebuild in Tailwind)
- **Decision**: Import the design's `tokens.css` + **`app.css`** into the app's global CSS, faithfully, so the design's component classes (`.topbar`, `.railnav`, `.pill`, `.card`, `.tbl`, `.seg`, `.sheet`, `.dialog`, `.toast`, `.guard`, `.riskchip`, `.proveitem`, `.stat`, `.empty`, `.input`, `.switch`, …) exist exactly as designed. React components emit those classes. Use Tailwind only for incidental layout where it doesn't fight the design.
- **Rationale**: The look lives in `app.css`. Re-expressing it in Tailwind is what caused the divergence. Porting guarantees parity and is faster.
- **Alternatives rejected**: Rebuild every style as Tailwind/shadcn (slow, lossy, already failed); CSS Modules per component (loses the design's global class coherence).

## D2 — Per-screen CSS
- **Decision**: Each `screens/*.js` ships a `<style>` block; collect these into the global stylesheet (or a co-located `screen-*.css` imported once), preserving the class names the markup uses.
- **Rationale**: Same parity-by-construction principle; the design already namespaces screen classes.
- **Alternatives**: Inline `<style>` per component (works but messy) — acceptable fallback if a screen's CSS is highly local.

## D3 — Routing: App Router route groups mirror the design's hash routes
- **Decision**: `(public)` = landing/connect/verify; `onboarding` (own layout); `(app)` = the authed shell + screens; `admin` = its own shell. Sub-routes (`vault/deposit`, `confirm/[intent]`, `trust/permissions`, `trust/exit`, `automation/grant`, `portfolio/[positionId]`, `premium/pay`) map the design's `base/sub` routes.
- **Rationale**: Real URLs + deep-linkable (SC-009) vs the design's single-page hash router; route groups give the right layout per class.
- **Alternatives**: One page with client hash routing (least faithful to a real app; poor deep-linking).

## D4 — Overlays: a lightweight `OverlayProvider` + portal
- **Decision**: A client context exposing `openProveIt / openWalletMenu / openNetworkMenu / openNotifications / openCommandPalette / toast`, rendering the design's sheet/dialog/menu/toast markup into a single portal with the scrim + transitions; ⌘K bound globally.
- **Rationale**: Reproduces `SP`'s overlay functions 1:1 without a heavy modal lib; matches the design's `.sheet/.dialog/.scrim/.toast` CSS.
- **Alternatives**: Radix/shadcn dialogs (would re-skin away from the design's exact markup/animation).

## D5 — Theme
- **Decision**: next-themes (`attribute="class"`, `storageKey="sp-theme"`, `defaultTheme="dark"`, no FOUC) — already wired in the scaffold. The design's inline pre-paint script is equivalent to next-themes' injected script.
- **Rationale**: Matches the design's `sp-theme`/`.light`/`.dark` contract exactly; no flash.

## D6 — Charts
- **Decision**: Recharts for the Portfolio net-worth/allocation and the Admin revenue dashboard; small inline SVG for the design's tiny sparklines/APY lines where it used hand-built SVG.
- **Rationale**: Recharts is the documented stack choice; faithful enough for the designed charts. The admin's hand-built SVG can be reproduced with Recharts equivalents (stacked bars, area, line+reference).
- **Alternatives**: Port the hand-built SVG verbatim (more effort, brittle) — use only where Recharts can't match cheaply.

## D7 — Icons
- **Decision**: Map the design's inline lucide-style icon set (`SP.P{…}`: spark, chat, portfolio, vault, shieldcheck, key, wallet, command, bell, door, pause, flask, zap, activity, coins, book, sliders, sun, moon, …) to **lucide-react** components; keep the bespoke **SparkMark** as an inline gradient SVG (coral→gold→blue) since it's brand-specific.
- **Rationale**: The design's icons ARE lucide paths; lucide-react is already a dependency.

## D8 — The Spark Core marketing landing
- **Decision**: Reproduce a faithful **dark-only** rendition of `Spark Core Landing.html` — its layout, copy, chapters, and gradient/particle aesthetic — approximating the GSAP/canvas animation with CSS/lightweight motion (honor reduced-motion). Defer pixel-exact canvas animation.
- **Rationale**: Spec marks the landing dark-only and notes the rich animation may be approximated (Assumptions). Visual structure + brand feel matter most.

## D9 — Mock data
- **Decision**: A single typed `lib/mock-data.ts` mirroring `SP.data` (wallet, networks [Base/Sui], bridgeAssets, mandate, netWorth, pnl, vault [netApy 3.87 / supplyApy 4.3 / perfFee 10 / HWM], allocation, series, recs, outcomes, notifications, txs, sessionKey=null). Screens read from it.
- **Rationale**: One source of truth; trivially swappable for live data later (out of scope now).

## D10 — Confirm gate
- **Decision**: One `ConfirmFlow` component (simulation → balance-changes → guardrail checklist → ack-gated Sign → success) rendered at `confirm/[intent]` AND inline in chat (two mount points), parameterized by intent (deposit/withdraw/swap/premium/bridge).
- **Rationale**: Matches the design's "single trust gate, also inline in chat"; preserves the sign-disabled-until-acknowledged invariant in one place.

## D11 — Out-of-scope stubs
- **Decision**: Wallet connect, AI agent, on-chain calls, real auth/RBAC are simulated (navigation/mock state) and clearly non-functional where shown; they do not block any flow. Admin is reachable unauthenticated with a visible "no auth yet" banner.
- **Rationale**: Per spec scope; keeps the build a pure UI recreation.
