# Implementation Plan: SparkPoint Pivot — AI-Native Onchain Hedge Fund (Launch MVP)

**Branch**: `001-sparkpoint-pivot-mvp` | **Date**: 2026-06-15 | **Spec**: ./spec.md

**Input**: Feature specification from `/specs/001-sparkpoint-pivot-mvp/spec.md`

## Summary

SparkPoint Pivot is a non-custodial, chat-based Personal DeFi Assistant paired with an AI-managed, 0-management / profit-only performance-fee Aave Yield Vault on Base (0% management, 0% on principal, 10% high-water-mark performance fee on realized yield only, hard-capped at 20%). The AI acts as fund manager — it reads the user's onchain activity, learns goals and risk tolerance into a mandate, ranks strategy recommendations with plain-language rationale, and proposes DeFi actions — but a **deterministic policy layer means the model never has final execution authority**, and **the user signs every transaction**. The primary requirement is verifiable native non-custody: funds are always withdrawable directly onchain even with all SparkPoint infrastructure offline, no SparkPoint-controlled address can ever withdraw user funds to itself, and the Trust Center makes these guarantees provable from onchain state. Launch scope is exactly one conservative ERC-4626 Aave Yield Vault plus a custom ERC-4337 account-abstraction stack, Aave v3 (USDC/ETH) and Aerodrome (swaps), behind beta gating (whitelist, per-user caps, geo-fence).

The technical approach is a four-layer system on a single chain (Base). A Next.js frontend renders the chat and all custody-critical surfaces, routing **every** state-changing action through a single signing chokepoint (`ExecutionDrawer`) and reading custody-critical state directly via RPC so it degrades safely when the backend is down. A self-hosted Python agent service (OpenClaw/Hermes + Anthropic Claude) hosts five modular agents coordinated by a deterministic DAG; it emits only unsigned, simulated, policy-approved `IntentBundle`s and holds no keys. A Foundry-built onchain layer enforces the five non-custody invariants by construction — pause never guards withdraw, no admin asset-movement selector exists, the vault is non-upgradeable, and session keys are bounded on-chain by `PolicyModule`. A Postgres + pgvector data layer indexes onchain truth, computes onchain-reconstructable PnL attribution, and captures the outcome/training dataset, while never being on the custody or withdrawal path. The deterministic policy layer (off-chain mirror of the on-chain `PolicyModule`) is the spine: no AI output becomes signable until it is independently re-derived, simulated (Tenderly), and approved by pure, LLM-free code.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22 (frontend + shared packages); Solidity (Foundry, `evm_version=cancun`) for contracts; Python 3.12 (managed by `uv`) for the agent service.

**Primary Dependencies**: Next.js 14+ (App Router) + React 18, TailwindCSS, shadcn/ui (Radix), Recharts; Wagmi v2 + Viem v2, WalletConnect v2, Coinbase Wallet SDK, `@tanstack/react-query` v5, Zod. Agent: FastAPI, Anthropic SDK (`client.beta.messages.tool_runner`, `@beta_tool`), OpenClaw/Hermes runtime, pgvector client. Contracts: OpenZeppelin v5 (ERC-4626/ERC-20/Pausable), `eth-infinitism/account-abstraction` (EntryPoint v0.7), Solady, Aave v3 + Aerodrome interfaces.

**Storage**: PostgreSQL (single instance, Base-only MVP) with `pgvector` for memory/embeddings; Redis read-through cache for hot display reads. No keys, secrets, or signed payloads are ever stored.

**Testing**: Vitest (unit) + Playwright (E2E against a testnet-pointed preview) for web; `ruff` + `mypy` + `pytest` (including policy-layer contract tests asserting out-of-policy rejection) for the agent; Foundry `forge` unit + fuzz + invariant + Base-fork tests for contracts (the N1–N5 invariant suite gates CI and deploy); Slither static analysis (advisory).

**Target Platform**: Base mainnet (chainId 8453) for production; Base Sepolia (chainId 84532) for testnet; Anvil fork of Base mainnet for local. Web on evergreen browsers, desktop + mobile equal priority.

**Project Type**: Web — a monorepo with a frontend (`apps/web`), a backend agent service (`services/agent`), onchain contracts (`contracts`, Foundry), and a shared seam (`packages/shared`).

**Performance Goals**: Chat first-token < ~1s perceived (SSE streaming); pre-trade simulation rendered before 100% of signature requests; portfolio/vault custody-critical reads resolve from direct RPC without backend dependency. Recommendation latency/availability is best-effort and explicitly subordinate to the withdraw-always SLO.

**Constraints**: The five non-custody invariants (N1–N5) hold by construction; every state-changing action is user-signed (per-action default) or bounded by an on-chain session key; withdraw-always must work with frontend + agents + RPC keys offline; the deterministic policy layer fails closed; only Aave v3 and Aerodrome are reachable; no execution proceeds on stale data beyond tolerance; geo-fence and whitelist gate app surfaces but never the onchain escape hatch; WCAG AA, tabular numerals, dark-first.

**Scale/Scope**: Closed alpha → public beta with a small whitelist and conservative fixed caps. ~14 authenticated product routes plus 3 backend-independent public surfaces (`/trust`, `/trust/permissions`, `/exit`); 9 contracts (5 named + adapters + cap/kill-switch governance); 5 agents; ~12 Postgres tables. Six core user flows; one conservative vault.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design. Checked against constitution v1.2.0 (the launch performance fee ratified in the amended Principle V at v1.1.0; the multi-network scope amendment — Base at launch + Sui fast-follow + a non-custodial bridge, with the Sui/Move stack and bridge mechanism flagged as a deferred follow-on — recorded at v1.2.0). The five non-custody invariants N1–N5, including withdraw-always (N2), now hold on every supported network.*

| # | Principle | Status | Note |
|---|-----------|--------|------|
| I | Non-Custodial by Construction (N1–N5) | **PASS** | Enforced at bytecode/modifier level (see Architecture §Non-custody enforcement). N1: no admin/sweep selector with external `to`; recipients forced to the user's account. N2: `withdraw`/`redeem` carry no `whenNotPaused`; Aave exit is a direct user→contract path. N3: factory binds owner to the user EOA; service holds no keys. N4: session keys bounded on-chain by `PolicyModule`, owner-only instant revoke. N5: vault is non-proxy, immutable; multisig is pause-only. |
| II | AI Proposes, Deterministic Policy + User Disposes | **PASS** | Guardrail agent contains **no LLM on its decision path**; the deterministic `policy/` module (pure, versioned, LLM-free) is invoked by a deterministic Coordinator, not by the model. Orchestrator emits only unsigned `IntentBundle`s; the user signs. No tool returns a signature or holds a key. |
| III | Provable, Not Promised | **PASS** | Every user-facing figure is reconstructable from onchain events + a block-anchored, logged price snapshot, and APY is shown net-of-everything (incl. the performance fee). Vault is 0-management / 0-on-principal at bytecode level; the only fee is a profit-only, high-water-mark performance fee on realized yield (default 10%, hard-capped 20%), provable on-chain via fee-share mints. Yield is pure Aave accrual. Trust Center reads exact permissions (incl. feeRecipient and feeRate) straight from chain. `policyVersion` + audit table record which ruleset ran. |
| IV | Security & Bounded Blast Radius (six guardrails) | **PASS** | G1 policy layer, G2 on-chain caps (deposits only), G3 pause-only multisig kill-switch, G4 mandatory Tenderly pre-trade sim, G5 address-level whitelist (adapters are the only protocol-naming code), G6 non-upgradeable fuzz-tested vault. Contracts ship with unit + fuzz + N1–N5 invariant tests before mainnet. |
| V | Conservative, Transparent Launch | **PASS** | Exactly one conservative 0-management / profit-only performance-fee Aave Yield Vault — 0% management, 0% on principal, 10% high-water-mark performance fee on realized yield only (hard-capped 20%), active at launch and verified against the amended Principle V (constitution v1.1.0): fee shares mint to a non-privileged feeRecipient, principal is never reduced, fee accrual is fail-open so withdraw-always holds, and feeRate is the only mutable param (timelocked, hard-capped, never altering custody). No token-incentive yield, no leverage. SRK is informational only — core functions verified to work with SRK absent (SC-013). |
| VI | Spec-Driven Development | **PASS** | This plan synthesizes the spec's US1–US6, FR-001…046 plus the performance-fee FRs FR-047…053, SC-001…014 plus the performance-fee SCs SC-015/SC-016, and invariants N1–N5; Phase 0/1 artifacts (research, data-model, contracts, quickstart) accompany it before tasks are generated. |
| VII | Simplicity & YAGNI | **PASS (1 tracked complexity)** | Multi-network: Base at launch + Sui fast-follow + a non-custodial bridge (per the amended Principle VII / the Multi-network architecture note); a single Aave Yield Vault at launch. The non-EVM (Move) Sui account/vault stack and the bridge mechanism/provider are a deferred follow-on (Follow-on table). YAGNI still defers multi-strategy vaults, ZK trade proofs, KYC/compliance, SRK v2, stocks/TradFi, and networks beyond Base + Sui. The one justified complexity is the **custom ERC-4337 stack**; the documented ZeroDev/Kernel fallback at the mid-build checkpoint preserves N1–N5 (see Complexity Tracking). Single VM + Docker Compose rather than Kubernetes; RAG-over-outcomes rather than fine-tuning. |

**Explicit invariant verification.**

- **N1 — No admin withdrawal**: PASS. The only functions moving underlying out of the vault are ERC-4626 `withdraw`/`redeem`, callable solely by the share owner/approved spender; no `onlyGuardian`/`onlyOwner` asset-movement function exists; any rescue helper hard-codes `to = owner()`. Machine-checked by `invariant_noAdminCanDrain`.
- **N2 — Withdraw-always**: PASS. Pause modifier is applied to deposit/deploy paths only; `redeem`/`withdraw` succeed while `paused == true` and with all SparkPoint infra offline. Machine-checked by `test_withdrawWorks_whenPaused_andOffline`.
- **N3 — User-owned keys**: PASS. `AccountFactory.createAccount` sets `owner` to the user's EOA at init with no SparkPoint co-signer or recovery backdoor; default mode is per-action signature; the agent generates no wallets and holds no user key.
- **N4 — Scoped, revocable, time-boxed automation**: PASS. `PolicyModule` enforces allowlist + per-tx/cumulative caps + max slippage + hard expiry in `validateUserOp` against account-associated storage; `revokeSessionKey` is owner-only and instant; a compromised agent can only churn in-scope. **N4 realization note:** the on-chain "allowlisted vaults only" is realized as the minimal target+selector allowlist strictly required to enter and exit the allowlisted vault(s) (vetted vault address + only the deposit/withdraw adapter selectors), NOT arbitrary swaps or general targets — a deliberate, invariant-preserving narrowing that, per Governance (re-ratification for custody changes), is an N4-touching refinement requiring explicit sign-off, not implicit introduction.
- **N5 — Non-upgradeable custody + verifiable non-custody**: PASS. Vault has no proxy/admin slot (EIP-1967 slots empty, no `Upgraded`/`AdminChanged`); custody semantics are non-upgradeable. `managementFee`/`entryFee`/`exitFee` are `internal pure constant` 0 and 0% on principal; the only fee is the profit-only, high-water-mark performance fee on realized yield, whose `feeRate` (default 10%, hard-capped 20%) is the sole mutable param — timelocked and multisig-bounded, and it can NEVER alter custody/withdraw/principal semantics. Any multisig/timelock role maps to `pause()`/`unpause()` and the capped `feeRate` only — no fund path; Trust Center renders the exact reads (incl. feeRecipient and feeRate).
- **AI-never-final-word**: PASS. The policy layer is invoked by the Coordinator, the LLM has no tool that mutates a verdict, and a rejected action returns to the user as an explanation, never a signable bundle.

**Gate result: PASS.** No unjustified violations. One justified complexity (custom AA stack) is tracked below with its invariant-preserving fallback.

## Project Structure

### Documentation (this feature)

```text
specs/001-sparkpoint-pivot-mvp/
├── plan.md              # This file
├── research.md          # Phase 0 output (open decisions: EntryPoint v0.7, Aave-ETH gateway, Aerodrome router/quote, price canon, IntentLog vs heuristic attribution)
├── data-model.md        # Phase 1 output (Postgres + pgvector schema, outcome/attribution model, key entities)
├── quickstart.md        # Phase 1 output (one-command local bring-up; withdraw-always drill)
├── contracts/           # Phase 1 output (ABIs/interfaces: vault, account, factory, validator, policy, adapters, IntentLog event)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by this plan)
```

### Source Code (repository root)

A single repo using pnpm workspaces + Turborepo for JS/TS, with the Python agent and Foundry contracts as first-class members driven through Turbo task wrappers. `packages/shared` is the contract⇄app seam: Foundry emits ABIs, policy constants (caps, slippage, allowlisted addresses) are defined once and consumed by both the off-chain policy layer and the on-chain `PolicyModule` deploy script so the two can never drift.

```text
sparkpoint-pivot/
├── apps/
│   └── web/                          # Next.js (App Router), Tailwind, shadcn/ui, Wagmi/Viem
│       ├── app/
│       │   ├── (marketing)/          # public landing
│       │   ├── app/                  # authenticated, beta-gated product shell
│       │   │   ├── onboarding/       # Flow 1 — chat-driven onboarding → mandate
│       │   │   ├── chat/             # Flow 2 — primary chat surface (structured cards)
│       │   │   ├── portfolio/        # Flow 3 — overview + [positionId]
│       │   │   ├── strategy/         # Flow 4 — ranked recommendations + [recId]
│       │   │   ├── vault/            # Flow 5 — vault detail + deposit/withdraw
│       │   │   ├── automation/       # session-key enable + revoke
│       │   │   ├── outcomes/         # outcome log (wins + losses)
│       │   │   ├── settings/         # risk profile, goals, wallet, theme
│       │   │   └── srk/              # SRK informational view (non-gating)
│       │   ├── trust/                # PUBLIC, backend-independent: hub + permissions ("prove-it")
│       │   ├── exit/                 # PUBLIC withdraw-always escape hatch (direct RPC writes)
│       │   ├── providers.tsx         # Wagmi + QueryClient + connectors
│       │   └── middleware.ts         # edge geo-fence (lets /exit + /trust through)
│       ├── components/               # ExecutionDrawer, chat cards, panels, NonCustodyBadge
│       └── lib/
│           ├── chain/                # viem clients, ABIs+addresses, account adapter (AA-SDK-swappable)
│           ├── agent/                # typed SSE/REST client + Zod card schemas
│           └── policy/               # client-side policy mirror (display-only; chain is truth)
├── services/
│   └── agent/                        # Python agent runtime (OpenClaw/Hermes), Dockerized
│       ├── pyproject.toml            # uv-managed
│       ├── Dockerfile
│       └── src/sparkpoint_agent/
│           ├── api/                  # FastAPI: /chat (SSE), /simulate, /build-tx, /portfolio…
│           ├── agents/               # portfolio_reader, strategy_recommender, executor, vault_manager, guardrail
│           ├── coordinator/          # deterministic DAG (no LLM router)
│           ├── policy/               # PURE deterministic policy layer (LLM-free) + evaluate()
│           ├── tools/                # scoped read tools + build/simulate tools (unsigned calldata only)
│           ├── data/                 # indexers, sources (Dune/subgraph/DeFiLlama), pricing
│           └── memory/               # Postgres + pgvector access, outcome/attribution workers
├── contracts/                        # Foundry (in-house)
│   ├── src/
│   │   ├── account/                  # SparkPointAccount, AccountFactory, SessionKeyValidator, PolicyModule
│   │   ├── vault/                    # SparkPointVault (ERC-4626, non-upgradeable)
│   │   ├── adapters/                 # AaveV3Adapter, AerodromeAdapter (only protocol-naming code)
│   │   ├── governance/               # CapRegistry, KillSwitch
│   │   └── interfaces/               # IPool, IAToken, IAerodromeRouter, IEntryPoint, IntentLog
│   ├── test/{unit,fuzz,invariant,fork}/   # N1–N5 as Foundry invariants; Base-fork Aave/Aerodrome
│   ├── script/                       # DeployCore, ArmGuardrails, Verify, post-deploy assertion
│   ├── deployments/<chain>/addresses.json  # committed provenance record (Trust Center / SC-004)
│   └── foundry.toml
├── packages/
│   └── shared/                       # TS types, generated ABIs, address registry, zod schemas, policy constants
│       └── src/addresses/{base,baseSepolia,localFork}.ts
├── infra/
│   ├── docker/                       # compose: agent + postgres/pgvector + anvil(forked Base)
│   └── deploy/                       # host provisioning, env templates, runbooks
├── .github/workflows/                # ci, contracts, web, agent, deploy-testnet, deploy-mainnet
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

**Structure Decision**: Web monorepo (frontend + backend agent service + onchain contracts + shared seam). The custody-critical separation is deliberate: `apps/web/lib/chain` and the public `trust/`+`exit/` routes read chain state directly and never hard-depend on `services/agent`, so withdraw-always (N2) survives backend loss; `packages/shared` centralizes ABIs and policy constants so the off-chain policy layer and on-chain `PolicyModule` cannot drift.

## Architecture (four layers)

### Multi-network architecture note (client-directed scope amendment — supersedes "Base-only at launch")

**Scope amendment (logged, not silent).** The original plan scoped launch as **Base-only**. The client subsequently directed the product to be **multi-network**, which **supersedes "Base-only at launch."** Phase order: **Base at launch (live)** and **Sui as the designated fast-follow network**; both are presented in the design. Networks beyond Base + Sui remain **out of scope**.

The two networks are **separate stacks**, deliberately not unified:

- **Base = the existing EVM stack** described in this plan in full — ERC-4337 (EntryPoint v0.7) account abstraction, the non-upgradeable ERC-4626 vault, the Aave/Aerodrome adapters, the deterministic policy layer, and the N1–N5 invariant suite. Nothing in the Base stack below changes.
- **Sui = a non-EVM (Move-based) stack, designed as a SEPARATE follow-on.** Sui does **not** use ERC-4337 / ERC-4626 / Solidity, so its account/vault architecture cannot be expressed as a refinement of the EVM contracts and is **not specified here**. The Sui-side account/vault architecture is a deferred technical design (see Complexity Tracking / Follow-on).
- **A non-custodial bridge between them.** Moving assets Base ↔ Sui is a dedicated product/UX surface (`/bridge`) with a simulation-backed `/confirm/bridge` sign gate and a chat **bridge intent** ("bridge", "sui", "cross-chain"). The bridge stays **fully self-custodial**: the user signs a lock/burn on the **source** network and receives funds in **their own wallet** on the **destination** network; SparkPoint **never** custodies funds in transit. **Withdraw-always (N2) holds on every network**, not just Base. The single simulation + guardrail checklist + you-sign gate applies to bridge actions exactly like swaps/deposits, and per-network + per-bridge caps wire to the policy-layer limits. The **bridge mechanism/provider** (route/lock-mint contracts on each side) is a deferred technical design (see Complexity Tracking / Follow-on).

**UX:** a persistent **network switcher** in the authenticated top bar (next to the wallet pill) sets the active network and the per-network wallet address; the product carries per-network state (per-network balances + the active-network indicator). User-facing trust copy is **"fully self-custodial"**; "non-custodial / self-custodial" remain accurate technical descriptors in architecture text.

### In-chat inline confirm (one component, two mount points — trust gate unchanged)

Chat-initiated deposit/swap/bridge render the confirm + sign flow **inline in the chat thread** (no navigation), running the **same trust gate** as the standalone routes: pre-trade simulation → balance changes → guardrail checklist → an acknowledgement checkbox that **gates** the Sign button → "nothing moves until you sign" → Sign → success. The standalone `/confirm/[intent]` routes **remain** for non-chat entry points (vault page, command palette, etc.). Implementation is **ONE `ConfirmFlow` component mounted at TWO points** (inline-in-chat + the route). This is a **UX-surface change only** — the sign-disabled-until-acknowledged invariant and the whole trust gate (and non-custody) are preserved 1:1; the `ExecutionDrawer` signing chokepoint and the "no card is signable without `policy.status==='approved'`" rule are unchanged.

### Brand / design system

The brand (design-system) source of truth is **`tokens.css`** — refer to it for all color/type tokens (cobalt blue + gold + coral warm accents over a deep indigo-navy dark base, the blue→cyan→gold→coral signature gradient, the violet→magenta 5-step risk scale, Geist Sans + Geist Mono with tabular numerals on financials). The earlier "orange spark accent" design-system note is **stale**; `tokens.css` overrides it.

### Layer 1 — User Layer (Frontend)

Next.js App Router with React Server Components for static shells and request-time RPC snapshots, and `'use client'` islands wherever the wallet, signing, live subscriptions, or chat stream are involved (the boundary is pushed as low as possible). State uses TanStack Query for async chain/server reads (cache, stale-marking, offline-aware) and Wagmi hooks for wallet/chain; no global store. The chat never free-renders model prose into actions — the agent streams a typed envelope, each block is validated with Zod and mapped to a registered card, and **no card is signable unless it carries a `policy: { status: 'approved' }` stamp** (unknown/invalid blocks render inert, fail-closed). Custody-critical surfaces (vault balances, caps, kill-switch, Trust Center, exit) read via direct Viem/Alchemy RPC; enriched/derived data (PnL history, recommendations, allocation) comes from the agent/indexer and is stale-markable. The single signing chokepoint is `ExecutionDrawer`, used by every write flow.

### Layer 2 — AI Orchestration Layer (Core Intelligence)

A self-hosted Python (FastAPI) service in Docker hosting five modular agents — **Portfolio Reader, Strategy Recommender, Executor, Vault Manager, and a Guardrail/Policy agent** — coordinated by a **deterministic Coordinator** (a code DAG, not an LLM router, so the model never chooses to escalate privilege). Reasoning runs on Claude (`claude-opus-4-8`, adaptive thinking, effort tuned per agent). Capability is enforced by **scoped tool registries**: read tools (Dune/subgraphs/DeFiLlama/RPC) are broadly available; build/simulate tools (returning unsigned calldata + a Tenderly sim) exist only in the Executor/Vault Manager registries; the Portfolio Reader physically cannot build a transaction. The Guardrail agent is a thin wrapper around the deterministic policy layer with **no model call on its decision path**. Every recommendation and action carries a plain-language `rationale` and `citations[]` grounded in tool results (not model memory). Contextual financial-literacy tips (FR-007, Literacy Tip entity) are realized as a dedicated, non-signable chat `TipCard` card-type emitted by a lightweight literacy capability in this orchestration layer: keyed to the user's current context/action (e.g., a swap, a cap, an Aave deposit), it streams as a complete validated `ChatBlock` alongside (never inside) recommendation/action cards, is display-only, and can never carry a `policy.status` stamp or a signable artifact. The orchestrator's only output for a state-changing action is an unsigned, inert, idempotent **`IntentBundle`** (steps as raw calldata, attached simulation, pinned `policyVerdict`, rationale, citations, `recommendationId`, short `expiresAt`).

### Layer 3 — Onchain Execution (Base)

Custom ERC-4337 (EntryPoint v0.7) account abstraction plus a non-upgradeable ERC-4626 vault, built with Foundry. `SparkPointAccount` (UUPS, **owner-only** upgrade — never SparkPoint) holds funds and validates UserOps via owner ECDSA or, for opted-in automation, `SessionKeyValidator` delegating scope checks to `PolicyModule`. `AccountFactory` deterministically deploys per-user accounts (CREATE2, counterfactual address shown pre-deploy), binding the owner to the user's EOA. `SparkPointVault` is a plain (non-proxy) ERC-4626 that is **0-management / profit-only performance-fee** (NOT 0-fee): `managementFee`/`entryFee`/`exitFee` are pure-constant 0 and 0% on principal, and the **only** fee is a profit-only performance fee charged ONLY on realized yield above a high-water mark on share price (default 10%, configurable on-chain within a hard cap of 20%) — never on principal and never in flat or down periods (no fee at/below the HWM). It is realized by **minting fee shares to a non-privileged `feeRecipient`** during lazy fee accrual (on deposit/withdraw/harvest): mint shares whose claim equals `feeRate × (assets gained above HWM since last accrual)`, then advance the HWM. `feeRecipient` is an ordinary share holder that redeems via the same `withdraw`/`redeem` path as any user, with no admin/withdraw authority over others' shares and no ability to block, delay, or reorder a redemption. Fee accrual **fails open** — it skips the fee and never blocks or reverts a redemption — so the withdraw path never depends on a fee being collectible. `deposit` is `whenDepositsAllowed` and cap-checked; `withdraw`/`redeem` carry **no pause modifier** and call `IPool.withdraw(...)` directly so the underlying lands on the receiver with no SparkPoint contract on the path. Protocol reach is centralized in two stateless adapters (`AaveV3Adapter`, `AerodromeAdapter`) — the **only** code that names protocol addresses + selectors — so the allowlist is enforced in one auditable place and reused by both the per-action and session-key paths; there is no generic `call(arbitraryTarget)`. `CapRegistry` (multisig-settable only within hard-coded max bounds) and `KillSwitch`/`Guardian` (pause-only) round out governance. Bundler: managed Alchemy bundler on Base (Pimlico fallback); an optional sponsorship paymaster pays gas only and is never on the custody/withdrawal path.

### Layer 4 — Data & Learning

A read/derive layer: Postgres + pgvector for memory, embeddings, indexed positions, and outcome logs, fed by an indexing pipeline (Alchemy `eth_getLogs` over a moving block window, with a small confirmation lag for reorg safety), enriched by hosted Aave/Aerodrome subgraphs and Dune analytics. Authority ordering is **RPC > subgraph > Dune**: any value used in a pre-sign gate is read fresh from RPC at decision time, never from cache. Every user-facing number (PnL, APY, allocation, outcome) is **onchain-reconstructable** from `onchain_events` + a block-anchored price snapshot (Chainlink-on-Base canonical; HTTP price APIs for long-tail display only, flagged). PnL attribution links a recommendation → its fulfilling tx(s) → realized PnL via an `intent_action_id` minted at proposal time (preferred: a dedicated `IntentLog` event; fallback: deterministic `(sender, target, selector, asset, amount, block window)` matching — `attribution_method` records which was used). Frozen `context_snapshots` joined to realized `outcome_logs` and `risk_events` yield the labeled training dataset; the loop is **retrieval-augmented (RAG over outcomes), not weight-updating** at launch. This layer holds no keys, has no write path to chain, and is an accelerator — never a dependency — for withdrawals.

### Request / execution sequence (single signing chokepoint)

```text
User message (chat)
  → Frontend POST /chat (SSE)
  → Coordinator DAG: PortfolioReader → StrategyRecommender → [user picks recommendation]
  → Executor builds ProposedAction (unsigned calldata) via scoped build tool
  → Guardrail/Policy: evaluate(action, context)   # PURE, LLM-free, fail-closed:
        schema → protocol allowlist (address-level) → asset allowlist → caps (deposits only)
        → mandate conformance → fresh Tenderly simulation (revert? slippage?) → kill-switch
        (withdrawals branch around caps + pause)
  → if rejected: return EXPLANATION to chat (no signable artifact) — STOP
  → if approved: emit IntentBundle (unsigned, simulated, policyVersion pinned)
  → Frontend ExecutionDrawer: render balance-deltas + guardrail checklist + "simulation passed"
        (Sign disabled on warning/over-slippage/policy-reject)
  → USER signs in their wallet (per-action) — or an in-scope session key signs
  → Frontend submits (bundler → EntryPoint.handleOps, or direct tx)
  → EntryPoint → SparkPointAccount.validateUserOp → execute → adapter/vault → Aave/Aerodrome
  → Data layer indexes the tx, writes outcome_log (entry block + frozen price snapshot)
```

The orchestrator's involvement ends at bundle emission; it never holds a key, never submits, and has no code path to a SparkPoint-controlled address. If the agent/frontend is offline the bundle simply never gets built — and the onchain withdraw path is unaffected.

### Non-custody enforcement (N1–N5 → concrete mechanisms)

| Invariant | Concrete mechanism (by construction) |
|-----------|--------------------------------------|
| **N1 — No admin withdrawal** | Vault moves underlying out only via ERC-4626 `withdraw`/`redeem` (share-owner/approved). No `sweep`/`rescueTokens(to)` with arbitrary `to`; rescue helpers hard-code `to = owner()`. Account `execute` is `_requireFromEntryPointOrOwner`; adapters force swap/deposit recipient to the account. Off-chain policy rejects any action whose recipient is not the user. Machine-checked: `invariant_noAdminCanDrain`. (FR-033, SC-004) |
| **N2 — Withdraw-always** | `withdraw`/`redeem` carry no `whenNotPaused`; only `deposit`/`mint`/deploy paths do. Aave exit is a direct `IPool.withdraw` to the receiver. The public `/exit` route + a withdraw-always runbook let the user redeem with frontend, indexer, and agent offline and while paused, using only their wallet + Alchemy RPC + bundled ABIs. Machine-checked: `test_withdrawWorks_whenPaused_andOffline`. (FR-034, SC-003) |
| **N3 — User-owned keys** | `AccountFactory` binds `owner` to the user's connected EOA at init; no SparkPoint co-signer/recovery; no server-side keystore. UI has no "create wallet for me" affordance; agent generates no wallets and never signs. Default execution = per-action owner signature. (FR-028, FR-035) |
| **N4 — Scoped, revocable, time-boxed automation** | One user-signed UserOp registers a session key whose `PolicyModule` policy realizes the constitution's "allowlisted vaults only" (N4) as the **minimal target+selector allowlist strictly required to enter and exit the allowlisted vault(s)** — i.e., the vetted vault address plus ONLY the specific adapter selectors needed to deposit/withdraw to those vault(s), NOT arbitrary swaps or general targets — together with per-tx + cumulative caps (monotonic `spent`), max-slippage floor, and hard `validUntil`, checked in `validateUserOp` against account-associated storage. `revokeSessionKey` is owner-only and instant (next UserOp fails). The off-chain policy mirror rejects out-of-scope proposals first; the on-chain module is the final backstop even if the agent is compromised. Machine-checked: `test_sessionKey_rejects*`, `test_revoke_isImmediate_andUnilateral`. (FR-029…032, FR-036, SC-008) |
| **N5 — Non-upgradeable custody + verifiable** | Vault is a plain contract (no proxy, no admin slot, immutable `USDC`/`AAVE_POOL`/`aUSDC`); custody semantics are non-upgradeable. `managementFee`/`entryFee`/`exitFee` are `internal pure constant` 0 and 0% on principal; the sole fee is the profit-only HWM performance fee, whose `feeRate` (default 10%, hard-capped 20% in bytecode) is the only mutable param — timelocked + multisig-bounded, and cannot alter custody/withdraw/principal semantics. Multisig is wired only to `pause`/`unpause`, the capped `feeRate`, and `CapRegistry` params within hard-coded ceilings — no fund path. Trust Center "prove-it" panel reads exact permissions (owner, validators, allowlisted targets, caps, expiry, pauser roles, `feeRecipient`, `feeRate`) straight from chain, each row linked to BaseScan. Machine-checked: vault has no EIP-1967 slots / `Upgraded`/`AdminChanged` events; permissions manifest generated from deployed addresses. (FR-037, FR-038, SC-012) |
| **Launch performance fee — preserves N1/N2/N5** | The profit-only HWM performance fee (10% of realized yield, hard-capped 20%) is built so non-custody is untouched. **N1:** fee shares mint to a **non-privileged `feeRecipient`** that redeems via the same `withdraw`/`redeem` path as any user — no admin/sweep selector, no withdraw authority over other users' shares, and it cannot block/delay/reorder a redemption; principal is never reduced because the fee accrues ONLY against realized gains above the HWM. **N2:** fee accrual **fails open** (skips the fee, never reverts/blocks) and the redemption path never depends on a fee being collectible, so withdraw-always holds even while paused and with all SparkPoint infra offline. **N5:** custody is non-upgradeable; `feeRate` is the only mutable param — timelocked, hard-capped at 20%, multisig-bounded — and can never alter custody/withdraw/principal semantics. Off-chain policy still pins recipients to the user. Machine-checked: `test_feeNeverReducesPrincipal`, `test_feeAccrual_failsOpen_onWithdraw`, `invariant_feeOnlyAboveHWM`, `test_feeRate_cappedAndTimelocked`, `invariant_feeRecipientHasNoWithdrawAuthority`. |

The split that makes "AI never has final word" structural: G1 (policy layer) and G4 (simulation) are *advisory* — they can over-block but never under-block; G2/G3/G5/G6 are *authoritative on-chain* and hold even if every off-chain layer is bypassed or malicious. The worst outcome of any off-chain failure is a blocked good action, never an executed bad one or trapped funds.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Custom ERC-4337 stack (`SparkPointAccount`, `AccountFactory`, `SessionKeyValidator`, `PolicyModule`) instead of adopting a battle-tested AA SDK from day one | The constitution names these contracts as authoritative and the product's session-key policy (recipient pinned to account, cumulative cap, hard expiry, and the **minimal target+selector allowlist strictly required to enter and exit the allowlisted vault(s)** — the vetted vault address plus ONLY the adapter selectors needed to deposit/withdraw to those vault(s), NOT arbitrary swaps or general targets) must be expressed exactly; building in-house gives full control over the deterministic on-chain `PolicyModule` that is the final backstop for N4 and the off-chain mirror. **N4 realization note:** expressing the constitution's "allowlisted vaults only" as this minimal target+selector allowlist is a deliberate, invariant-preserving refinement — it narrows, never widens, what a session key can reach. Per the constitution's Governance (re-ratification for custody changes), this is an N4-touching refinement that MUST be explicitly signed off and not introduced implicitly through implementation. | Adopting ZeroDev/Kernel up front was rejected only as the *default*, not as ineligible — it remains the **documented mid-build fallback** if the custom stack threatens the Sep 4 date. The fallback swaps **only the account/validator/policy trio**; the vault, adapters, caps, and kill-switch are SDK-agnostic and ship as our own contracts regardless. Before adoption it is re-verified against all five invariants (owner is sole admin with no vendor key, on-chain-scoped user-revocable session keys, no upgrade/recovery fund path, withdraw works with vendor infra offline); if any fails, the SDK is not eligible. The frontend abstracts wallet/AA behind a thin `lib/chain/account` adapter so the swap changes one module, not the UI. |

No other complexity is unjustified. Single VM + Docker Compose (not Kubernetes), RAG-over-outcomes (not fine-tuning), and a single Postgres instance all follow Principle VII. (The "Base-only single-vault scope" framing is superseded by the multi-network amendment above; the Base launch stack itself stays a single conservative vault, and Sui ships as a separate follow-on rather than expanding the launch surface.)

### Follow-on (deferred technical design — flagged, not specified here)

The multi-network amendment introduces two deliberately **deferred** technical designs that are **out of scope for this plan** and must be designed as separate follow-on increments before any Sui/bridge build:

| Follow-on (deferred) | Why deferred / out of scope here | What must be designed separately |
|---|---|---|
| **Sui (non-EVM / Move) account + vault stack** | Sui is non-EVM and does **not** use ERC-4337 / ERC-4626 / Solidity, so it cannot be expressed as a refinement of the Base EVM contracts; fabricating a detailed Move spec now would be speculative. The Base EVM contract spec is unchanged and authoritative for Base. | A dedicated Move-based account/vault architecture that re-establishes N1–N5 (especially withdraw-always / N2 and user-sole-key / N3) on Sui by construction, plus its own policy/simulation/sign gate equivalents. |
| **Bridge mechanism / provider** | The bridge is specified here only at the **product / UX / non-custody level** (self-custodial lock/burn on source → user's own wallet on destination, never custodied; per-bridge caps; simulation + you-sign gate). The concrete lock-mint/route contracts on each side and the provider/route-selection logic are a separate cross-network contract design. | The on-source lock/burn + on-destination mint/release contracts (EVM side notes go in `contracts/`; the Sui side is non-EVM/Move), provider/route selection, per-bridge caps wired to policy limits, and the cross-network proof of non-custody. |

## Phase 0 / Phase 1 Pointers

This plan is accompanied by the standard Spec Kit Phase 0/1 artifacts in `specs/001-sparkpoint-pivot-mvp/`:

- **`research.md`** (Phase 0): resolves the flagged open decisions with rationale + safe defaults — EntryPoint v0.7 pin (v0.6 fallback), Aave-ETH via `WrappedTokenGatewayV3` (USDC-only safe default), Aerodrome router/pool addresses + slippage quote source, price canon (Chainlink-on-Base vs HTTP for long-tail), `IntentLog` event vs heuristic attribution, cost-basis method (average-cost at MVP), reorg confirmation lag, embedding model pinning, and the Base Sepolia integration-coverage gaps.
- **`data-model.md`** (Phase 1): the Postgres + pgvector schema (`users`, versioned `mandates`, `chat_messages`, `memory_chunks`, `indexed_positions`, `onchain_events`, `recommendations`, `outcome_logs`, `context_snapshots`, `risk_events`, `data_source_health`, `indexer_cursors`) and the onchain-reconstructable PnL attribution model, mapped to the spec's Key Entities.
- **`contracts/`** (Phase 1): ABIs/interfaces for `SparkPointVault`, `SparkPointAccount`, `AccountFactory`, `SessionKeyValidator`, `PolicyModule`, the two adapters, `CapRegistry`/`KillSwitch`, and the requested `IntentLog` event — the source for `packages/shared` ABIs and the frontend `lib/chain` clients.
- **`quickstart.md`** (Phase 1): one-command local bring-up (agent + pgvector + Anvil fork of Base) and the withdraw-always drill (redeem with frontend + agents offline, while paused).
