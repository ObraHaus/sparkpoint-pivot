# SparkPoint Pivot Constitution

SparkPoint Pivot is "The First AI-Native Onchain Hedge Fund": a non-custodial, chat-based Personal DeFi Assistant paired with an AI-managed Aave Yield Vault on the Base chain. The AI is the fund manager, but a deterministic policy layer means the model never holds final execution authority — the user signs every transaction. This constitution governs how the project is specified, built, and shipped. It learns your goals, explains every move, proves every result onchain, and never touches your keys.

## Core Principles

### I. Non-Custodial by Construction (NON-NEGOTIABLE)

Native non-custody is the product's foundation, not a feature. The five non-custody invariants MUST hold in every design, contract, and agent behavior, and no code path may violate them:

- **N1 — No admin withdrawal.** Only the user can move funds to an external address. The protocol and agents MAY direct strategy within an on-chain allowlist but MUST NOT have any code path that withdraws user funds to a SparkPoint-controlled address.
- **N2 — Withdraw-always escape hatch.** The user MUST be able to exit directly on-chain (redeem vault shares, withdraw from Aave) even if SparkPoint's frontend and agents are entirely offline. The kill-switch MAY pause new deployments but MUST NEVER block user withdrawals.
- **N3 — User-owned keys.** The user MUST be the sole owner/admin signer of their smart account. The system MUST NOT generate or hold custody of user wallets. Default execution mode is per-action user signature.
- **N4 — Scoped, instantly-revocable, time-boxed automation.** Opt-in automation MUST use an ERC-4337 session key bounded by the on-chain PolicyModule (allowlisted vaults only, per-tx and cumulative caps, max slippage, hard expiry). The user MUST be able to revoke instantly and unilaterally without SparkPoint's cooperation. A compromised agent MUST NOT be able to exceed its on-chain scope.
- **N5 — Non-upgradeable custody semantics + verifiable non-custody.** The vault MUST be single-purpose and non-upgradeable. Any multisig or timelock MUST govern PAUSE ONLY, never fund movement. The Trust Center MUST surface exact on-chain permissions so non-custody is provable, not promised.

Any proposed change that touches custody semantics MUST be rejected by default and requires explicit re-ratification under Governance before it can proceed.

### II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)

The model is an advisor, never an authority. AI agents (portfolio reader, strategy recommender, executor, vault manager, guardrail/policy agent) MAY analyze, rank, and propose actions. A deterministic policy layer MUST validate every agent output before any execution path is reachable; output failing policy MUST be rejected, never "best-effort" executed. Every state-changing transaction MUST be signed by the user, with per-action signing as the default. The only exception is scoped session-key automation, which remains bounded by the on-chain PolicyModule (Principle I, N4). AI reasoning runs on Claude (Anthropic API), but Claude's output MUST NOT reach the chain without passing the deterministic policy layer and the applicable user-signing or session-key constraint. AI hallucination MUST NOT be able to cause an unauthorized or out-of-policy transaction.

### III. Provable, Not Promised

Trust is earned on-chain, not asserted in marketing copy. Realized results and current permissions MUST be reconstructable from on-chain data. Yield MUST be reported honestly and net of everything (fees, costs, slippage); the launch vault is 0-management / profit-only performance-fee (0 management fee, 0 fee on principal, capped (≤20%) high-water-mark performance fee on realized yield, default 10%, fully disclosed), and yield MUST come from the underlying protocol (Aave v3), never from token incentives. The product MUST NOT lead with return projections or promise specific future returns. Any figure shown to users MUST be current and verifiable, and each strategy recommendation MUST be labeled over time with its realized PnL (outcome logging). The Trust Center MUST display the exact on-chain permissions granted, so users can independently confirm the non-custody invariants.

### IV. Security & Bounded Blast Radius

Every component MUST be designed so that the worst-case outcome is contained. The six guardrails are mandatory and MUST all be present at launch:

1. The deterministic policy layer wraps every AI decision (the model never has the final word).
2. Hard caps MUST be enforced on-chain: per-user TVL cap, total protocol cap, and vault deposit cap.
3. A multisig kill-switch MUST exist that is PAUSE-ONLY — it halts new deployments and MUST NEVER block user withdrawals.
4. Pre-trade simulation (Tenderly) MUST be previewed to the user before they sign.
5. Only whitelisted protocols are permitted at launch: Aave v3 and Aerodrome. Interaction with any other protocol MUST be impossible by construction.
6. The vault MUST be bounded, single-purpose, and non-upgradeable.

All smart contracts MUST keep a simple, auditable surface and MUST have unit and fuzz tests before mainnet. Complexity that widens the blast radius MUST be justified or removed.

### V. Conservative, Transparent Launch

The launch is deliberately narrow and honest. The vault product at launch MUST be a SINGLE conservative Aave Yield Vault (ERC-4626) with a 0 management fee, 0 fee on principal, and a capped (≤20%), profit-only, high-water-mark performance fee on realized yield (default 10%), fully disclosed and non-custodial: deposit USDC, earn Aave yield, withdraw anytime, non-upgradeable. We only earn when you earn — never on your principal, never by taking custody. The fee recipient is a non-privileged share holder, and the performance fee NEVER touches principal or the withdraw path; feeRate is the only mutable param (timelocked, hard-capped), never altering custody. The SRK token MUST be non-essential to core vault function — the vault MUST work fully without SRK, which activates a later cycle. The product MUST NOT offer token-incentive yield, leveraged strategies, or any product that contradicts the conservative posture at launch. New strategies MUST NOT be added under the banner of the launch vault.

### VI. Spec-Driven Development (NON-NEGOTIABLE)

Work flows strictly: constitution → spec → plan → tasks → implementation. No implementation may begin without an approved spec and plan. Specs MUST define WHAT and WHY without leaking implementation detail; plans MUST pass the Constitution Check gate before tasks are generated; tasks MUST trace back to the spec. Cross-artifact consistency MUST be maintained — spec, plan, and tasks MUST NOT contradict each other or this constitution. Any change to scope, architecture, or invariants MUST be reflected back into the governing artifacts before code lands.

### VII. Simplicity & YAGNI

Depth over breadth; ship the narrow thing well. At launch the system MUST remain Base-only and single-vault. The following are explicitly deferred and MUST NOT be built into the launch scope: multi-strategy vaults (market-neutral, volatility harvesting, yield optimization), ZK trade proofs, SRK v2 utility and governance, KYC/compliance gating, additional protocols, stocks/TradFi, and a general-purpose financial assistant. Speculative generality MUST be rejected; build for the current milestone, not an imagined future. Where the custom ERC-4337 stack threatens the schedule, the project MUST fall back to a battle-tested AA SDK (ZeroDev/Kernel) at the mid-build checkpoint, and any fallback MUST preserve the five non-custody invariants.

## Additional Constraints

These are authoritative and non-negotiable for the launch build. External security audit, penetration testing, legal review (ToS/risk disclosures/geo rules), and marketing/growth are owned by SparkPoint's internal teams and are out of scope for this build.

**Chain & scope.** Single chain: Base. Single launch vault. DeFi integrations are limited to Aave v3 (deposit/withdraw USDC and ETH) and Aerodrome (swaps from chat). No other protocols or chains at launch.

**On-chain contracts (named, authoritative).** Custom ERC-4337 account abstraction: `SparkPointAccount`, `AccountFactory`, `SessionKeyValidator`, `PolicyModule`; plus `SparkPointVault` (ERC-4626, 0-management / profit-only performance-fee — 0 management fee, 0 fee on principal, capped (≤20%) high-water-mark performance fee on realized yield, default 10%; non-upgradeable custody semantics). Contracts MUST be built with Foundry (in-house) and MUST ship with unit and fuzz tests.

**Architecture — four layers.**
1. User Layer (Frontend): Next.js (App Router), TailwindCSS, shadcn/ui. Surfaces: chat AI interface, portfolio overview (PnL/risk/allocation), strategy suggestions, execution-confirmation UI, vault dashboard, SRK view, Trust Center. Wallets: Wagmi v2 + Viem, WalletConnect v2, Coinbase Wallet SDK. Desktop and mobile are equal priority.
2. AI Orchestration Layer: OpenClaw / Hermes agent framework, self-hosted in Docker. Modular, upgradable agents — portfolio reader, strategy recommender, executor, vault manager, and a guardrail/compliance/policy agent — coordinating via tool-calling and agent-to-agent communication. Reasoning runs on Claude (Anthropic API) behind the deterministic policy layer.
3. Onchain Execution (Base): the named AA contracts and the vault, with execution limits, whitelisted protocols, per-user and total caps, and a multisig kill-switch.
4. Data & Learning: on-chain data via Dune API + hosted subgraphs (Aave, Aerodrome); off-chain market data via DeFiLlama + price feeds; Postgres + pgvector for memory and embeddings; a training loop capturing user-action outcomes, strategy performance, and risk-event labels.

**Infra & tooling.** Alchemy (Base RPC), Tenderly (transaction simulation + Web3 Actions), Sentry, GitHub + GitHub Actions. Agent runtime in Docker.

**Launch must-haves.** Chat-based AI assistant; chat-driven onboarding (goals + risk tolerance → personalized mandate); portfolio reader; strategy recommender (ranked against the user's goal); the custom ERC-4337 stack; opt-in execution layer (user-signed, per-action by default); Aave v3 deposit/withdraw (USDC, ETH); Aerodrome swaps from chat; the Aave Yield Vault; contextual financial-literacy tips; outcome logging; and beta gating (whitelist, per-user caps, geo-fenced frontend).

**Timeline.** 12-week build, Jun 1 – Sep 4, 2026. Target: production-ready on Base by Sep 4, 2026.

## Development Workflow & Quality Gates

- **Spec Kit flow.** Every feature MUST progress through spec → plan → tasks before implementation. The `plan.md` Constitution Check gate MUST pass; any violation MUST be resolved or recorded as an explicitly justified exception before tasks are generated.
- **Code review.** All changes MUST be reviewed against this constitution. Reviews MUST explicitly confirm the non-custody invariants (Principle I) and the AI-disposition rule (Principle II) are not weakened.
- **Contract testing.** Smart contracts MUST have unit and fuzz tests (Foundry) and MUST NOT reach mainnet without them.
- **Contract audit before mainnet.** No contract may be deployed to Base mainnet until the internal team's security audit and hardening have been completed for that contract.
- **Simulation before sign.** No execution flow may ship that lets a user sign a transaction without first presenting a Tenderly pre-trade simulation.
- **Beta-gating before real funds.** Real-fund exposure MUST begin only behind beta gating: whitelist, strict per-user and total caps, kill-switch armed, and geo-fenced frontend — via a small closed alpha first.
- **Fallback checkpoint.** At the mid-build checkpoint, the custom AA stack is re-evaluated; if it threatens the schedule, the team falls back to a battle-tested AA SDK, and the fallback MUST be re-verified against all five non-custody invariants before proceeding.

## Governance

This constitution supersedes all other practices and conventions. When any spec, plan, task, or implementation conflicts with it, the constitution wins and the conflicting artifact MUST be corrected.

**Amendments.** Amendments MUST be proposed in writing with rationale and the affected artifacts, reviewed, and approved before they take effect. Dependent templates and artifacts (spec, plan, tasks, checklists) MUST be updated for consistency as part of any amendment.

**Re-ratification for custody changes.** Any amendment that touches the five non-custody invariants (N1–N5), the pause-only nature of the kill-switch, the AI-disposition rule, or the non-upgradeable vault semantics requires a super-majority approval and explicit re-ratification. Such changes MUST NOT be made implicitly through implementation.

**Versioning.** This constitution uses semantic versioning: MAJOR for backward-incompatible governance or principle removals/redefinitions, MINOR for new principles or materially expanded guidance, PATCH for clarifications and wording. The version line MUST be updated on every amendment.

**Compliance.** All PRs and reviews MUST verify compliance with these principles. Added complexity MUST be justified against Principles IV and VII; unjustified complexity MUST be removed.

**Amendment log.**
- **2026-06-18 — v1.0.0 → v1.1.0 (MINOR).** Ratified the launch performance fee in Principle V (Conservative, Transparent Launch): the launch Aave Yield Vault is now 0-management / profit-only performance-fee rather than 0-fee — 0 management fee, 0 fee on principal, and a capped (≤20%), profit-only, high-water-mark performance fee on realized yield (default 10%), realized by minting fee shares to a non-privileged feeRecipient that redeems via the standard withdraw path. Custody is unchanged: N1–N5, the pause-only kill-switch, the AI-disposition rule, and non-upgradeable custody semantics all hold; fee accrual is fail-open and never blocks withdraw-always; feeRate is the only mutable param (timelocked, hard-capped, never altering custody). This is a STANDARD amendment, not a super-majority re-ratification, because N1–N5 are unchanged.

**Version**: 1.1.0 | **Ratified**: 2026-06-15 | **Last Amended**: 2026-06-18
