# SparkPoint — Web App (`apps/web`)

The SparkPoint Pivot web client — a **fully self-custodial**, chat-based AI DeFi assistant + AI-managed Aave Yield Vault on Base. Built with **Next.js 16 (App Router) · TypeScript · TailwindCSS v4 · pnpm**.

> Part of the [`sparkpoint-pivot`](../../README.md) monorepo. See the repo `CLAUDE.md` for conventions and `DEVELOPMENT.md` for the full setup.

## Develop (pnpm only)

```bash
pnpm install          # from this directory
cp .env.example .env.local   # then fill in (all optional in dev)
pnpm dev              # http://localhost:3000
```

Other scripts: `pnpm build`, `pnpm start`, `pnpm lint`.

## What's here (scaffold)

- **Theme** — design tokens (`.dark`/`.light`) in `src/app/globals.css`, mapped into Tailwind; wired via **next-themes** (`storageKey="sp-theme"`, default dark, no flash). Toggle in the user menu.
- **App shell** — `src/components/app-shell.tsx`: top bar, "Fully self-custodial" badge, account menu, disclaimer strip, desktop rail nav + mobile bottom tabs.
- **Routes** — `src/app/(app)/*`: chat, portfolio, strategies, vault, bridge, trust (+ permissions, exit), fees, premium, outcomes, srk, learn, settings (skeletons). `/` → `/chat`.
- **Providers** — `src/components/providers.tsx`: next-themes + wagmi v3/viem (Base + Base Sepolia) + react-query.

## Status

Foundation scaffold — theme, shell, navigation, and the build pipeline. Per-screen high-fidelity UI is ported from `../../docs/design-handover/showcase` screen by screen. Wallet connect and data/agent wiring are stubs for now.

## Env (`.env.example`)

| Var | Use |
|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Enables the WalletConnect connector (optional in dev) |
| `NEXT_PUBLIC_BASE_RPC_URL` | Base mainnet RPC (Alchemy); falls back to public RPC |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC; falls back to public RPC |
