# Changelog

All notable changes to **SparkPoint Pivot** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Status:** pre-build. Only the Spec-Driven-Development planning artifacts and the design handover exist today — **no application code has been written yet** (the build stage, ⑤, has not started). Build window: Jun 1 – Sep 4, 2026.

> **Note on this project:** SparkPoint Pivot is an **ObraHaus client product**, not part of the ObraHaus Apps Ecosystem. It is hosted in the ObraHaus GitHub org *for now* (ownership may transfer to the client later). It therefore **does not** use obrahaus-console SSO (it uses **wallet auth**), **does not** route AI through obrahaus-governor (it calls **Anthropic / an OpenAI-compatible API directly**), and uses its **own brand** (cobalt / gold / coral), not the OH Primary design system. These are sanctioned client-project divergences — see DEVELOPMENT.md.

## [Unreleased]

### Added
- **Web app scaffold** (`apps/web`) — the build stage (⑤) has begun. Next.js 16 (App Router) + TypeScript + TailwindCSS v4 + pnpm, on `feat/web-scaffold`:
  - **Theme system** — design tokens ported to `globals.css` (`.dark`/`.light`), wired via **next-themes** (`attribute="class"`, `storageKey="sp-theme"`, default dark, no flash); light/dark toggle in the user menu.
  - **App shell** — top bar (brand, primary nav, "Fully self-custodial" badge, network-switcher + wallet-pill stubs, account menu), non-custody disclaimer strip, desktop rail nav + mobile bottom tabs.
  - **Routes** — skeleton pages for chat, portfolio, strategies, vault, bridge, trust (+ permissions, exit), fees, premium, outcomes, srk, learn, settings; `/` redirects to `/chat`.
  - **Wallet/data providers** — wagmi v3 + viem (Base + Base Sepolia) + react-query wired (connect UI is a stub for now).
  - typecheck / lint / build all green.

## [0.1.0] - 2026-06-18

Initial planning baseline. Spec-Driven-Development artifacts and design handover, no application code.

### Added
- **Constitution v1.2.0** (`.specify/memory/constitution.md`) — core principles (non-custodial by construction; AI proposes, deterministic policy + the user disposes; provable not promised; conservative, transparent launch). Ratified 2026-06-15.
  - **v1.1.0** amendment — ratified the launch performance fee (0 management, 0 on principal, profit-only high-water-mark performance fee, default 10%, ≤20% cap).
  - **v1.2.0** amendment — **multi-network scope**: Base (launch) + Sui (designated fast-follow), connected by a fully self-custodial bridge; networks beyond Base + Sui out of scope. The non-EVM Sui account/vault stack and the bridge mechanism are a separate follow-on technical design. Adopted "fully self-custodial" as the canonical user-facing trust term.
- **Spec Kit launch feature** `specs/001-sparkpoint-pivot-mvp/` — `spec.md` (WHAT/WHY), `plan.md` (HOW / architecture), `research.md` (Phase 0 decisions), `data-model.md` (Phase 1 entities), `contracts/` (API + smart-contract interfaces), `quickstart.md` (end-to-end validation), `tasks.md` (dependency-ordered, story-grouped tasks).
- **High-level plan** `docs/high-level-plan/` — foundational product/strategy plan (v1, v2 "Natively Non-Custodial", and PDFs).
- **Design handover** `docs/design-handover/` — brief for Claude Design (web-app flows & UI) plus the live showcase; establishes the SparkPoint brand (cobalt / gold / coral).
- **Revenue model** — single 0-management / profit-only performance-fee Aave Yield Vault (0% management, 0% on principal, 10% performance fee on yield above a high-water mark; net-of-everything yield).
- **Living docs** — this `CHANGELOG.md`, plus `DEPLOYMENT.md`, `COOLIFY.md`, `DEVELOPMENT.md`, `MIGRATIONS.md` (ObraHaus playbook §7), tailored to the pre-build reality.

### Changed
- _N/A — initial entry._

### Fixed
- _N/A — initial entry._

### Database
- No migrations yet — Postgres + pgvector schema is planned (see MIGRATIONS.md). The migration history table is seeded empty.

### Infrastructure
- No services deployed. Dev/staging will run on **OH Coolify** (Proxmox homelab); client **production** will run later on the client's own infra/domain (likely sparkpoint.io), TBD. See DEPLOYMENT.md / COOLIFY.md (everything marked *planned — not yet deployed*).

[Unreleased]: https://github.com/ObraHaus/sparkpoint-pivot/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ObraHaus/sparkpoint-pivot/releases/tag/v0.1.0
