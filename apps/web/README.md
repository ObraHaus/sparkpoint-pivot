# SparkPoint — Web App (`apps/web`)

The SparkPoint Pivot web client — a **fully self-custodial**, chat-based AI DeFi assistant + AI-managed Aave Yield Vault on Base. Built with **Next.js 16 (App Router) · TypeScript · TailwindCSS v4 · pnpm**.

This app is a **faithful 1:1 recreation of the approved Claude Design** (`../../docs/design-handover/showcase/`) — the design's `tokens.css` + `app.css` + per-screen CSS are ported into the global stylesheet, and the showcase's `window.SP` behaviours (routing, shell, overlays, theme, data) are recreated as idiomatic React.

> Part of the [`sparkpoint-pivot`](../../README.md) monorepo. See the repo `CLAUDE.md` for conventions and `DEVELOPMENT.md` for the full setup.

## Develop (pnpm only)

```bash
pnpm install          # from this directory
cp .env.example .env.local   # then fill in (all optional in dev)
pnpm dev              # http://localhost:3000
```

Other scripts: `pnpm build`, `pnpm start`, `pnpm lint`. Typecheck / lint / production build are green; **37 routes**.

## What's here

- **Entry flow** — the animated **Spark Core** marketing landing (`/`, dark-only), simulated wallet **connect** + **verify**, and chat-driven **onboarding** (goal → risk → mandate → first recommendation).
- **App shell** (`src/components/shell/`) — `TopBar` (brand spark-mark, primary nav, "Fully self-custodial" pill, Base/Sui network switcher, wallet pill, ⌘K, notifications, avatar), the non-custody `DisclaimerStrip`, the "Trust & control" `TrustRail` (+ Withdraw/Exit), and a mobile `MobileTabBar` + More sheet.
- **Overlays** (`src/components/overlays/`) — `OverlayProvider` (portal): the Prove-it sheet (Can/Can't + the five structural guarantees), wallet menu, Base/Sui network menu, notifications sheet, ⌘K command palette, avatar menu (+ theme toggle), and toasts.
- **Screens** (`src/app/(app)/*` + `src/components/screens/`) — chat (structured cards + tool-step thinking + inline confirm), portfolio (+ position detail), vault (net-APY breakdown incl. the 10% performance fee over a high-water mark, deposit/withdraw), strategies, the shared **confirm trust gate** (`confirm/[intent]`: simulation → balance changes → guardrail checklist → **acknowledgement-gated Sign** → success), Trust Center (+ permissions, exit), automation, bridge (Base↔Sui), fees, premium (+ pay), outcomes, learn, srk, settings, notifications.
- **Admin panel** (`src/app/admin/*`, `src/components/admin/`) — a distinct observe-only shell at `/admin` (no auth yet — a dismissible scaffold banner says so), a "View as" role switcher, the graphical **revenue dashboard**, and overview/users/usage/tvl/system/kill-switch (pause-only · 2-of-3 · never blocks withdrawals)/config/audit.
- **Theme** — design tokens (`.light`/`.dark`) in `src/app/globals.css`, mapped into Tailwind; wired via **next-themes** (`storageKey="sp-theme"`, **default light**, no flash). The marketing landing is **dark-only** (its palette is route-scoped to `.spark-core-root`, independent of the theme default).
- **Data** — a single typed `src/lib/mock-data.ts` mirrors the design's `SP.data`; every screen reads from it.
- **Providers** (`src/components/providers.tsx`) — next-themes + the network/session context + the overlay provider; wagmi v3/viem (Base + Base Sepolia, `injected()` connector only) + react-query are wired but **inert** in this UI build (WalletConnect/Coinbase connectors land with the wallet-auth feature).

## Structure

```text
src/
├── app/                  # route groups: (public) connect/verify · onboarding · (app) shell+screens · admin
│   ├── globals.css       # ported tokens + app.css + shared atoms
│   └── page.tsx          # the Spark Core landing
├── components/{shell,overlays,admin,ui,screens}/
└── lib/                  # mock-data, nav, network/session, icons, utils
```

## Out of scope (simulated / stubbed — later features)

Real wallet connection, the real AI agent, on-chain transactions, and real authentication/authorization are **not** implemented in this UI build — they are simulated with the design's mock data and clearly non-functional where shown (the admin panel is unauthenticated, clearly labeled). They are wired in as separate features.

## Parity

A Playwright harness in [`../../e2e`](../../e2e) diffs every screen (visual + DOM text + interactions), incl. the admin panel, against the approved showcase. Verdict + per-screen report: [`../../docs/parity`](../../docs/parity).

## Env (`.env.example`)

| Var | Use |
|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Reserved for the upcoming WalletConnect connector (not wired in this UI build) |
| `NEXT_PUBLIC_BASE_RPC_URL` | Base mainnet RPC (Alchemy); falls back to public RPC |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC; falls back to public RPC |

## Status

The **faithful UI build is complete** — every screen, overlay, the confirm gate, and the admin panel match the approved design (see `../../docs/parity`). Wallet connect, the AI agent, on-chain wiring, real auth, and deployment to OH Coolify (dev/staging) are the next features.
