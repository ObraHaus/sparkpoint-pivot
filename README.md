# SparkPoint Pivot — The First AI-Native Onchain Hedge Fund

> A **non-custodial**, chat-based **Personal DeFi Assistant** paired with an **AI-managed Aave Yield Vault** on **Base**. Autonomous AI agents (reasoning on Claude, fenced by a deterministic policy layer) manage capital, risk, and strategy — and **the protocol can never hold, move, or lose your money.**

This repository is the home for the SparkPoint Pivot **source code and docs**. It is organized for **Spec-Driven Development** using [GitHub Spec Kit](https://github.com/github/spec-kit).

---

## Delivery pipeline

```
① High-level app plan  →  ② Architecture + Spec (Spec Kit)  →  ③ Tasks  →  ④ High-fidelity design (Claude Design)  →  ⑤ Build
        (docs/)                    (specs/001-…/)                            (docs/design-handover/)
```

- **①** Foundational product/strategy plan — see [`docs/high-level-plan/`](docs/high-level-plan/) (v1, v2 "Natively Non-Custodial", and PDFs).
- **②–③** Spec-Kit artifacts for the launch feature — see [`specs/001-sparkpoint-pivot-mvp/`](specs/001-sparkpoint-pivot-mvp/).
- **④** Design handover for Claude Design — see [`docs/design-handover/`](docs/design-handover/).

## Repository structure

```
sparkpoint-pivot/
├── .specify/                     # Spec Kit: templates, scripts, memory/constitution.md
├── .claude/skills/               # Spec Kit slash-command skills (/speckit-*)
├── specs/
│   └── 001-sparkpoint-pivot-mvp/ # The launch feature (spec → plan → tasks)
│       ├── spec.md               # WHAT & WHY (product spec)
│       ├── plan.md               # HOW (architectural / implementation plan)
│       ├── research.md           # Phase 0 — decisions & rationale
│       ├── data-model.md         # Phase 1 — entities & relationships
│       ├── contracts/            # Phase 1 — API + smart-contract interfaces
│       ├── quickstart.md         # Phase 1 — end-to-end validation
│       └── tasks.md              # Dependency-ordered, story-grouped tasks
└── docs/
    ├── high-level-plan/          # Foundational plan (input to everything)
    └── design-handover/          # Brief for Claude Design (web-app flows & UI)
```

## Spec Kit workflow (`/speckit-*` skills)

| Skill | Purpose |
|---|---|
| `/speckit-constitution` | Establish/After-update project principles (`.specify/memory/constitution.md`) |
| `/speckit-specify` | Create/update the feature specification (`spec.md`) |
| `/speckit-clarify` | De-risk ambiguous areas before planning |
| `/speckit-plan` | Generate the implementation/architecture plan + design artifacts |
| `/speckit-tasks` | Generate the dependency-ordered task list |
| `/speckit-analyze` | Cross-artifact consistency check |
| `/speckit-implement` | Execute the plan |

> The constitution, spec, plan, and tasks in this repo were authored to conform to the Spec Kit templates and serve as the source of truth for stage ⑤ (build).

## Core principles (see the [Constitution](.specify/memory/constitution.md))

1. **Non-custodial by construction** — the protocol can *direct* strategy but has no code path to take user funds.
2. **AI proposes, deterministic policy + the user disposes** — the model never has final execution authority; the user signs every transaction.
3. **Provable, not promised** — results and permissions are reconstructable on-chain.
4. **Conservative, transparent launch** — a single 0-fee Aave Yield Vault; honest, net-of-everything yield.

## Tech stack (authoritative)

Frontend **Next.js (App Router) · TailwindCSS · shadcn/ui** · Wagmi v2 + Viem · WalletConnect v2 · Coinbase Wallet SDK
Agents **OpenClaw / Hermes** (self-hosted, Docker) reasoning on **Claude (Anthropic API)** behind a deterministic policy layer
Onchain (Base) **Custom ERC-4337** (SparkPointAccount, AccountFactory, SessionKeyValidator, PolicyModule) + **SparkPointVault (ERC-4626)** · Aave v3 · Aerodrome · Foundry
Data **Dune API · DeFiLlama API · hosted Aave/Aerodrome subgraphs · Postgres + pgvector**
Infra **Alchemy (Base RPC) · Tenderly (simulation + Web3 Actions) · Sentry · GitHub Actions**

---

*Confidential — internal project repository. Build window: Jun 1 – Sep 4, 2026.*
