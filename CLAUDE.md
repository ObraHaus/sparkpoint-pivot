<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/069-morpho-earn-registry/plan.md
<!-- SPECKIT END -->

> **Active feature = 001 (Phase-2 MVP)**: non-custodial Aave ERC-4626 vault + custom ERC-4337 account + fail-closed policy engine + chat assistant. Execution plan rev 3.3 (artifact 31e5f3f5). **Authoritative live state: [`docs/orchestration/wave-state.json`](docs/orchestration/wave-state.json) + [`GATES.md`](docs/orchestration/GATES.md)** (the per-task checkboxes in `tasks.md` are the original plan, not maintained). As-built topology: [`docs/architecture-as-built.md`](docs/architecture-as-built.md).

---

# SparkPoint Pivot — repo guide (read with the ObraHaus Playbook)

**Read first:** the [ObraHaus Playbook](https://github.com/ObraHaus/obrahaus-playbook) (the OH way of planning, building, reviewing, deploying, operating) — then this file, then the living docs below.

## What this repo is

**SparkPoint Pivot** — "The First AI-Native Onchain Hedge Fund": a non-custodial, chat-based Personal DeFi Assistant + an AI-managed Aave Yield Vault on Base (multi-network: Base at launch, Sui fast-follow). Spec-driven via [Spec Kit](https://github.com/github/spec-kit). The **web app build has begun** (`apps/web`): a faithful 1:1 recreation of the approved Claude Design — every screen, the shell, overlays, the confirm gate, and the admin panel are built with the design's mock data (see `apps/web/README.md` and the parity report in `docs/parity/`). Real wallet connect, the AI agent, on-chain calls, real auth, and the backend/services are the next features. The repo also holds the Spec Kit artifacts, the design handover + live showcase, and the planning docs.

> **Client project — important.** SparkPoint Pivot is a **CLIENT product**. It is **NOT part of the ObraHaus Apps Ecosystem**. It lives in the ObraHaus org GitHub **for now**; ownership may transfer to the client later. Because it is not an OH ecosystem app, several playbook defaults are deliberately diverged (below).

## Sanctioned client-project divergences from the playbook

Approved by the operator (aldrickb) on **2026-06-19**. These are intentional — not drift.

| Playbook default | SparkPoint Pivot | Why |
|---|---|---|
| `obrahaus-<app>` repo naming (§4) | **`sparkpoint-pivot`** | Client brand, not an OH internal product. |
| Centralized auth via **obrahaus-console** SSO (§11) | **Wallet auth** (Wagmi/WalletConnect/Coinbase Wallet) | Non-custodial DeFi app; its users are the client's, not OH's. |
| AI/SMS **only via obrahaus-governor** (§12) | **Direct Anthropic / OpenAI-compatible API** (or the project's own future gateway) | Not an OH ecosystem app; client owns AI billing/infra. |
| **OH Primary** design system + shared profile-menu (§13) | **SparkPoint's own brand** — cobalt/gold/coral, matched to sparkpoint.io; risk scale violet→magenta; Geist Sans/Mono. No OH profile-menu / "powered by OH Governor" block. | Client product with its own identity. `tokens.css` is the brand source of truth; see `docs/design-handover/04-design-system.md`. *(Central registration in the playbook's `design/` registry: offered, pending.)* |
| Production on **OH Coolify** (§5) | **Client infra / domain (TBD, e.g. sparkpoint.io)** for production | OH Coolify is used for **dev/staging only**. |

## ObraHaus conventions this repo DOES adopt

- **Branch flow (§3):** `feature/*` → **`develop`** → **`main`** (production). Batched, deliberate, **never-Friday** prod deploys (PH/Asia-Manila).
- **Spec-driven (§9):** Spec Kit lifecycle (constitution → specify → clarify → plan → tasks → analyze → implement). Constitution at `.specify/memory/constitution.md` (currently **v3.0.0**, ratified 2026-07-30 — Morpho Vault V2 Fee Wrappers + Robinhood Chain 4663; see `specs/024-multi-protocol-vaults/constitution-amendment-v3.0.0.md`).
- **Security gate (§9):** **OH Defender** PR scan (`.github/workflows/oh-defender.yml`). ⚠️ **Onboarding required:** the repo must be onboarded in the Defender console to provision the `DEFENDER_API_URL` / `DEFENDER_API_KEY` Actions secrets (operator action). Until wired, the scan won't run.
- **Living docs (§7):** `CHANGELOG.md`, `DEPLOYMENT.md`, `COOLIFY.md`, `DEVELOPMENT.md`, `MIGRATIONS.md` — keep updated in the same change that alters behavior.
- **⚠️ No changelog drift — housekeeping is immediate, not deferred.** SparkPoint has **TWO** changelogs and BOTH must stay current at all times: (1) the repo **`CHANGELOG.md`** (developer record, Keep-a-Changelog), and (2) the **in-app changelog** shown to clients/testers at `/changelog` (admin-managed `content_entries` rows, edited via **Admin → Updates**; reads `GET /content/changelog`). **After every PR / merge / shipped update, update both in the same beat** — never leave them stale. A user-visible feature or fix MUST get a client-friendly in-app entry (semi-technical: understandable to a non-dev, but making clear something in the core changed even when it isn't visually obvious); behavior/schema/infra changes MUST get a `CHANGELOG.md` bullet. The in-app changelog is client-facing — an empty or thin one makes the team look idle, so treat drift as a defect. Backdate in-app entries via the `published_at` field (Admin → Updates date picker, or `POST /admin/content`) so the timeline reads honestly. Constitution + `.specify` artifacts count as living docs too.
- **Dev/staging hosting (§5):** OH Coolify (Nixpacks, `pnpm --frozen-lockfile`, `http://` domains, deployment-record verification). See `COOLIFY.md`.
- **Commits (§10):** Conventional Commits + the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. SemVer + `vX.Y.Z` tags on prod merges.
- **Confirm before** any production deploy, Coolify-mutating command, or `git push` / PR / merge.

## Map

- `specs/001-sparkpoint-pivot-mvp/` — spec · plan · tasks · contracts · data-model · quickstart.
- `docs/high-level-plan/` — foundational plan (+ PDFs). `docs/revenue-model/` — revenue model (+ PDF).
- `docs/design-handover/` — Claude Design handover + flows + design system; `showcase/` = the deployed clickable prototype (light/dark).
- Living docs: `CHANGELOG.md` · `DEPLOYMENT.md` · `COOLIFY.md` · `DEVELOPMENT.md` · `MIGRATIONS.md`.
