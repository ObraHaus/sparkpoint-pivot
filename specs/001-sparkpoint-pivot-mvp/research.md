# Phase 0 Research: SparkPoint Pivot — AI-Native Onchain Hedge Fund (Launch MVP)

**Branch**: `001-sparkpoint-pivot-mvp` | **Date**: 2026-06-15 | **Spec**: [`spec.md`](./spec.md) | **Constitution**: [`../../.specify/memory/constitution.md`](../../.specify/memory/constitution.md)

**Purpose**: Resolve the significant technical decisions and unknowns that gate the implementation plan. Each entry records the **Decision**, **Rationale**, **Alternatives considered**, and — where the choice touches custody — **how it preserves the five non-custody invariants (N1–N5)**. Decisions are grounded in the spec (FR-/SC-), the constitution (Principles I–VII, six guardrails), and the four domain designs. Genuine unknowns are flagged as **Open question** with a stated safe default rather than guessed.

**Invariant shorthand** (constitution Principle I): N1 no-admin-withdrawal · N2 withdraw-always · N3 user-owned-keys · N4 scoped/revocable/time-boxed automation · N5 non-upgradeable custody + verifiable non-custody.

**How to read this**: "Authoritative on-chain" means the rule holds even if every off-chain layer is bypassed or malicious. "Advisory/fail-closed" means the layer can only over-block (a good action is denied), never under-block (a bad action executes). This split is the spine of the whole system: the deterministic floor is on-chain; everything above it is advisory.

---

## 0. Decision Index

| # | Decision area | Maps to |
|---|---|---|
| 1 | Custom ERC-4337 stack vs ZeroDev/Kernel (and the fallback trigger) | FR-028–032, N3/N4, Principle VII |
| 2 | Base EntryPoint / bundler / paymaster choice | FR-022, FR-028, N1/N2/N3 |
| 3 | ERC-4626 vault wrapping Aave v3 | FR-017/018, N2/N5, guardrail 6 |
| 4 | Session-key automation design | FR-029–032, N4 |
| 5 | Deterministic policy layer placement | FR-008, FR-016/021/023/025/027, Principle II, guardrails 1/2/4/5 |
| 6 | OpenClaw / Hermes + Claude (reasoning model & SDK) | FR-005/006/007/014/015, Principle II |
| 7 | Postgres + pgvector (memory, outcomes, embeddings) | FR-003/004, FR-039–041, Principle III |
| 8 | Tenderly pre-trade simulation gate | FR-021/023, SC-002, guardrail 4 |
| 9 | Dune / DeFiLlama / subgraphs data sourcing | FR-009–012, FR-014, Principle III |
| 10 | Testnet (Base Sepolia) strategy | Dev Workflow, W3–W7 |
| 11 | Caps, kill-switch, and verifiable-non-custody surfacing | FR-025/026/038, N5, guardrails 2/3 |
| 12 | Outcome-logging / PnL-attribution data model | FR-039–041, SC-010, Principle III |

---

## 1. Custom ERC-4337 Account-Abstraction Stack vs ZeroDev/Kernel

**Decision**: Build the custom ERC-4337 stack named in the constitution — `SparkPointAccount`, `AccountFactory`, `SessionKeyValidator`, `PolicyModule` — in-house with Foundry, targeting EntryPoint **v0.7**. Keep a pre-vetted **ZeroDev/Kernel** fallback as the documented schedule-risk path, decided at the **W7 mid-build checkpoint**. De-risk the swap from day one by making the **vault, adapters, `CapRegistry`, and kill-switch SDK-agnostic** (they ship as our own contracts regardless of which account layer is live), so a fallback replaces only the account/validator/policy trio.

**Rationale**:
- The constitution names these four contracts as authoritative on-chain artifacts and mandates Foundry in-house, so the custom stack is the default per Principle VI (spec-driven, named contracts).
- A custom account lets us pin exactly the behavior the invariants need — sole-owner admin, a fixed validator set (1-byte signature prefix selecting owner-ECDSA vs session-key), no SparkPoint co-signer or recovery backdoor — rather than inheriting an SDK's broader modular-validator surface (smaller blast radius, Principle IV).
- Principle VII explicitly authorizes the ZeroDev/Kernel fallback "where the custom ERC-4337 stack threatens the schedule," re-verified against N1–N5 before adoption. So the fallback is a constitutional requirement, not an improvisation.

**Fallback trigger (concrete)**: The custom stack is re-evaluated at the **W7 internal-testing checkpoint**. Trigger conditions (any one): the AA core is not feature-complete and passing the N1/N4 invariant suite on Base Sepolia by end of W6; or the `validateUserOp` bundler-acceptance work (EntryPoint associated-storage rules) is unresolved and blocking the session-key path; or contract complexity is exceeding what the W8–9 internal audit window can cover. If triggered, swap `DeployCore` for a Kernel-config deploy script; deploy steps that **arm caps + arm kill-switch + assert non-custody** (research §10/§11) are **unchanged and still required**.

**Fallback invariant-preservation gate (security sign-off before adoption)**: Kernel/ZeroDev is eligible only if all hold — (a) owner is the user EOA via the ECDSA root validator, no vendor key anywhere in the authority graph (**N3**); (b) session keys are expressible as on-chain-scoped permissions with allowlisted target, per-tx + cumulative cap, max slippage, and hard expiry, **user-revocable without vendor cooperation** (**N4**); (c) no upgrade/recovery/guardian module grants SparkPoint any fund-movement path (**N1, N5**); (d) withdraw works with vendor infra offline (**N2** — and because the vault is SDK-independent, this is automatically satisfied). If a Kernel permission can't natively express the **cumulative** cap, wrap calls through our `PolicyModule`-as-plugin so the deterministic cap math stays ours.

**Invariant preservation (custom path)**: N3 — `AccountFactory.createAccount(owner, salt)` binds the user's connected EOA as sole owner at `initialize`, immutable except via owner `transferOwnership`; no backend signer is ever an owner, default mode is per-action owner signature. N4 — automation is a session key with zero standing authority beyond what `PolicyModule` grants (research §4). The account itself is the only contract that can move its funds, gated by `_requireFromEntryPointOrOwner`.

**Alternatives considered**:
- **Safe{Core} / Safe modules** — battle-tested multisig, but heavier than a single-owner smart account and its module surface is broader than the fixed validator set we want; rejected for blast-radius (Principle IV) and as overkill for a single-owner-per-user model.
- **Pure EOA + approvals (no AA)** — would lose session-key automation (N4 has no home) and gasless first-deposit UX; rejected because N4 and FR-029–032 require on-chain-scoped automation.
- **ERC-7579 fully-generic modular account** — maximum flexibility, but generic modular validators widen the attack surface; rejected in favor of a fixed validator set (the Kernel fallback is ERC-7579, accepted only under the gate above).

**Open question — account upgradeability**: Make `SparkPointAccount` UUPS **owner-only** (user can adopt the Kernel fallback or patch a bug with no SparkPoint authority) vs fully immutable. Either preserves N1/N3 (only the owner can upgrade; SparkPoint never can). **Safe default**: owner-only UUPS for fallback flexibility; drop to a non-upgradeable account under schedule pressure (new factory implementation serves future users). Note the **vault is always non-upgradeable** regardless (N5) — this question is about the account only.

---

## 2. Base EntryPoint / Bundler / Paymaster Choice

**Decision**: Pin canonical ERC-4337 **EntryPoint v0.7** (same singleton address across chains incl. Base), set as a deploy-time constant and an immutable `entryPoint()` on the account. **Bundler**: Alchemy Bundler on Base as primary (we already use Alchemy for RPC), **Pimlico** documented as fallback; no self-hosted bundler at launch. **Paymaster**: optional sponsorship paymaster for whitelisted beta users' first deposit, strictly off the custody path — it pays gas only and is never on the withdrawal path.

**Rationale**:
- v0.7 (`PackedUserOperation`, packed `validationData`) is the current widely-supported version with better gas-griefing protection than v0.6; a managed bundler avoids self-hosting toil under solo-dev capacity (Principle VII).
- Alchemy-as-both-RPC-and-bundler reduces moving parts; Pimlico is a like-for-like fallback if Alchemy v0.7 support on Base lags.
- A gasless first deposit measurably improves beta onboarding without touching invariants.

**Invariant preservation**: A malicious bundler/paymaster is in the threat model. The paymaster **only pays gas, has no authority over user funds, and is not on the withdrawal path**, so it cannot touch N1/N2. Validation (`validateUserOp`) only ever authorizes the owner signature or an in-scope session key — a bundler cannot forge either. **Safe default if paymaster integration slips**: users pay their own gas in ETH on Base (cheap), which fully preserves all invariants.

**Alternatives considered**:
- **EntryPoint v0.6** — kept as the explicit fallback if a bundler's v0.7 support on Base is incomplete at build time; the account abstracts the version behind an immutable `entryPoint()`, so a wrong pin is caught in tests, not prod.
- **Self-hosted bundler** — rejected at launch (operational burden vs solo-dev capacity; Principle VII).
- **ERC-20 paymaster (user pays gas in USDC)** — deferred; ETH-gas-or-sponsored covers the beta, and a token paymaster adds surface for no launch-critical benefit.

**Open questions (confirm at build time)**: (a) Alchemy Bundler v0.7 support on Base — must verify `eth_estimateUserOperationGas` / `pm_*` acceptance of our `validateUserOp` (which stays within EntryPoint associated-storage rules so it remains bundler-acceptable; see §4). (b) Exact EntryPoint v0.7 singleton address on Base — pin in `script/config/base-{mainnet,sepolia}.json`.

---

## 3. ERC-4626 Vault Wrapping Aave v3

**Decision**: `SparkPointVault` is a plain (non-proxy, immutable-bytecode) ERC-4626 vault — OpenZeppelin v5 `ERC4626` + `ERC20` shares + a minimal custom deposit-side-only `Pausable`. `asset = USDC`. `totalAssets() = aUSDC.balanceOf(self) + idle USDC`. `deposit` supplies into Aave v3 (`IPool.supply(USDC, assets, self, 0)`) and mints shares; `withdraw`/`redeem` call `IPool.withdraw(USDC, assets, receiver)` and burn shares. Fees are `internal pure constant 0` (0-fee at the bytecode level, not config). Caps enforced via a `maxDeposit` override. **The single most load-bearing decision**: the pause modifier is on `deposit`/`mint` **only — never on `withdraw`/`redeem`**.

**Rationale**:
- ERC-4626 gives standard share accounting and tooling compatibility; aTokens rebase 1:1 with accrued interest, so share price reflects Aave yield automatically with **no oracle on the custody path** (eliminates price-manipulation of the vault — guardrail-aligned, Principle III honest-yield).
- A plain non-proxy contract makes custody semantics frozen at deploy (N5) and provable by the absence of EIP-1967 proxy slots / `delegatecall`.
- 0-fee as `internal pure constant` makes the constitution's "0-fee" claim bytecode-level, not a settable parameter (Principle III/V).

**Invariant preservation**:
- **N2 (the critical modifier placement)**: `withdraw`/`redeem` carry no `whenNotPaused`; only `deposit`/`mint` do. The redemption path calls `IPool.withdraw` directly — no SparkPoint contract, oracle, agent, or off-chain service is on it. A user can redeem via Etherscan/`cast`/any wallet with the SparkPoint frontend and agents fully offline and the kill-switch paused (SC-003). **Decision — partial-exit on low Aave liquidity**: clamp `redeem` to `maxWithdraw` available rather than hard-revert, so a user always gets a partial exit (safe default for N2); we do not add our own liquidity lock.
- **N5**: no `upgradeTo`, no admin slot, immutable `USDC`/`AAVE_POOL`/`aUSDC` refs set in constructor. The **only** functions that move USDC out are the standard ERC-4626 `withdraw`/`redeem`, callable solely by the share owner/approved spender — **no `onlyGuardian`/`onlyOwner` asset-movement function exists**, which makes N1 true by construction and machine-checkable (grep the ABI for any admin function with an external-`to` transfer path → must be none).

**Alternatives considered**:
- **Upgradeable (UUPS/Transparent) vault** — rejected outright; directly violates N5. Any future "fix" is a *new* deployment the user opts into by withdrawing and redepositing, never an admin upgrade.
- **Custom share math instead of OZ ERC4626** — rejected; OZ v5's virtual-offset (decimal-offset) defends against the share-inflation/donation attack for free. We fuzz round-trips to confirm no user extracts more than deposited + yield.
- **Vault holds idle USDC and lends opportunistically** — rejected; widens scope beyond "single conservative Aave Yield Vault" (Principle V/VII). All deposited USDC routes straight to Aave.

**Open question — Aave-ETH path**: The spec lists USDC + ETH for Aave (FR-019), but the **vault** asset is USDC-only (FR-017). ETH on Aave needs the `WrappedTokenGatewayV3` (the v3 Pool takes ERC-20s). **Safe default**: ship the vault as USDC-only (the must-have); support Aave **direct** ETH supply/withdraw via the gateway behind a flag in the adapter, gated on confirming the gateway address on Base in deploy config.

---

## 4. Session-Key Automation Design (N4)

**Decision**: Opt-in auto-rebalance authorizes an ERC-4337 **session key** registered on `SessionKeyValidator`, bounded by an on-chain `PolicyModule` `Policy` struct: `sessionKey`, `validAfter`/`validUntil` (hard expiry), `perTxCap`, `cumulativeCap`, running `spent` (monotonic), `maxSlippageBps`, and an `allowed[target][selector]` map. The user signs **one** UserOp to register; revocation is owner-only `revokeSessionKey` that deletes the policy entry (next UserOp with that key fails `validateUserOp` because validation reads live storage). At authorization, the allowlist is seeded with **exactly** vault `deposit`/`withdraw`, `AaveV3Adapter` supply/withdraw, `AerodromeAdapter` swap — and **nothing else** (no ERC-20 `approve`, no arbitrary `call`).

**`validateUserOp` flow (deterministic, on-chain)**: recover signer → require it equals a registered, non-revoked `sessionKey` → `require(block.timestamp ∈ [validAfter, validUntil])` → decode `(target, value, innerData)` and `require(allowed[target][selector])` → extract notional, `require(notional ≤ perTxCap)` and `require(spent + notional ≤ cumulativeCap)`, then `spent += notional` → for swaps, enforce embedded `amountOutMin` against the policy slippage floor → **force recipient/`to` = the account itself** (never an external/SparkPoint address).

**Rationale**: This makes "the agent can never exceed scope even if compromised" (FR-030, SC-008) a structural property: the most an attacker who fully owns the agent host can do is churn within the allowlist, within caps, before expiry — never exfiltrate (the recipient is forced to the account, N1). Revocation reading live storage makes it **instant and unilateral** with no SparkPoint cooperation and no timelock (FR-031).

**Invariant preservation**: This *is* N4. Compromise containment + forced-recipient = N1 holds even on the automated path. The off-chain policy layer (§5) rejects out-of-scope proposals *and* the on-chain module rejects them even if the agent is compromised — defense in depth.

**Alternatives considered**:
- **Off-chain-only scoping (agent self-limits)** — rejected; violates N4's "compromised agent can't exceed scope," since off-chain limits don't bind a compromised host.
- **On-chain oracle call inside `validateUserOp` for slippage** — rejected: EntryPoint restricts storage access in the validation phase (oracle reads risk bundler rejection + manipulation surface). **Decision — slippage source**: enforce the `amountOutMin` embedded in the swap calldata (agent must set it within policy) plus the AMM's own min-out revert; the user-facing Tenderly sim bounds realized slippage. **Safe default**: if `amountOutMin == 0` or below the policy floor, reject in validation.
- **ERC-7579 generic session-key module** — deferred; the fixed `Policy` struct is smaller-surface (Principle IV). It is the Kernel-fallback shape (§1).

**Hard constraint designed around**: `validateUserOp` must obey EntryPoint's associated-storage rules. `PolicyModule` state is stored in the **account's associated storage** (keyed by the account) so validation stays compliant and bundler-acceptable — a real constraint, not assumed away.

---

## 5. Deterministic Policy Layer Placement

**Decision**: The deterministic policy layer exists in **two mirrored places** with a clear authority split:
1. **Off-chain** — a pure, versioned, side-effect-free Python module (`policy/`) in the agent service, **zero LLM calls**, invoked by the deterministic `Coordinator` (not by the LLM). Every `ProposedAction` passes `evaluate(action, context) -> PolicyVerdict` before it can become a signable `IntentBundle`. This ensures the user is **never even shown** a signable out-of-policy action (FR-008, FR-023, FR-027, SC-006).
2. **On-chain** — `PolicyModule` + the vault caps + the protocol allowlist (adapters) are the **authoritative backstop**: the rules hold even if the entire off-chain layer is bypassed or malicious.

`evaluate()` checks, **ordered and fail-closed**: (1) schema/shape validity; (2) protocol allowlist (address-level, ∈ {Aave v3 Pool, Aerodrome Router, SparkPointVault}); (3) asset allowlist (USDC/ETH; vault deposit == USDC); (4) caps (per-user TVL, total protocol, vault deposit, per-tx — projected post-action state; **withdrawals never cap-gated**); (5) mandate conformance (forward-compat hook); (6) slippage/simulation gate (fresh Tenderly sim, reject on predicted revert or slippage > user max); (7) kill-switch state (`if action.is_withdrawal: skip_pause_check`). The verdict carries a pinned `policyVersion` logged with every recommendation/outcome for auditability.

**Rationale**:
- Principle II requires the model to be advisory and a deterministic layer to validate every output before any execution path is reachable. Putting the off-chain layer **in front of the signable artifact** means hallucinations and confused-deputy proposals are stripped before the user ever sees a sign button.
- Mirroring it on-chain (the same address-level allowlist + caps) means the off-chain layer is **not a security boundary on its own** — a bug there degrades to over-/under-suggestion, not loss, because the chain still rejects an out-of-policy tx. This is what makes "AI never has the final word" structural rather than a prompt instruction.
- The off-chain layer is invoked by the Python `Coordinator`, and the LLM has **no tool that mutates a verdict** — so the model literally cannot override it. A rejected action returns as an *explanation* ("exceeds your per-user cap"), never as a signable bundle.

**Invariant preservation**: Realizes Principle II and guardrails 1/2/4/5. The pause-skip-for-withdrawals branch (check 7) enforces N2 off-chain to match the on-chain vault. The address-level allowlist (check 2) enforces the whitelist (guardrail 5) symmetrically with the adapters. **Anti-drift decision**: the off-chain allowlist/caps are **derived from the same on-chain source of truth** (read from `PolicyModule`/`CapRegistry`) and the shared policy constants (caps, slippage bps, allowlisted addresses) live once in `packages/shared`, consumed by both the off-chain layer and the on-chain `PolicyModule` deploy script — so the two cannot silently diverge.

**Alternatives considered**:
- **On-chain policy only** — rejected as the *sole* layer; the user could be shown a signable tx that then reverts on-chain, wasting gas and trust. The off-chain mirror saves gas and informs consent (it is fail-closed and advisory, not authoritative).
- **Off-chain policy only** — rejected; an off-chain-only gate is bypassable and is not a real custody boundary (a compromised orchestrator could skip it). Defense in depth requires the on-chain backstop.
- **LLM-as-judge guardrail agent** — explicitly rejected: the "Guardrail/Policy Agent" is an organizational label only; its verdict is produced by **pure code with no model call on the decision path**. An LLM in the enforcement path would make "the model never has the final word" a prompt instruction, not a structural fact (Principle II).

---

## 6. OpenClaw / Hermes + Claude (Reasoning Model & SDK)

**Decision**: A self-hosted Python (FastAPI) agent service in Docker, running the OpenClaw/Hermes agent framework with **five modular agents** — portfolio reader, strategy recommender, executor, vault manager, guardrail/policy. A deterministic Python `Coordinator` (not an LLM router) invokes agents in a fixed per-flow DAG. Reasoning runs on **Claude `claude-opus-4-8`** via the official Anthropic Python SDK, with **adaptive thinking** (`thinking={"type": "adaptive"}`) and per-agent `output_config.effort` (recommender `high`, executor/vault `medium`, portfolio `low`). Tool-calling uses the SDK's `@beta_tool` decorator + `client.beta.messages.tool_runner` for read paths and a **manual agentic loop** for the execution path (so the policy check is interposed between "model proposed" and "action becomes signable"). Structured agent outputs use `output_config.format` / `messages.parse()` with Pydantic schemas; **no assistant prefill** (removed on Opus 4.8). Refusals handled by checking `stop_reason == "refusal"` before reading content.

**Rationale**:
- `claude-opus-4-8` is the current Opus-tier model and the project's mandated reasoning provider (constitution Layer 2). Adaptive thinking is the recommended on-mode for Opus 4.8 (the older fixed `budget_tokens` extended-thinking config is removed on 4.8 and would 400 — do not use it); it lets the model self-moderate thinking depth and removes the need to hand-tune a token budget. `effort` is tuned per agent because the recommender is judgment-heavy while the portfolio reader is mechanical.
- A **deterministic Coordinator + scoped per-agent tool registries** is the prompt/tooling boundary: capability is enforced by **which tools exist in an agent's registry**, not by asking the model to behave. The Portfolio Reader physically cannot build a transaction because no build tool is in its registry. This is belt-and-suspenders with §5: the enforcement is the registry + policy layer, not the prompt.
- A **fixed DAG, not free agent-to-agent routing**: free routing would let an LLM choose to escalate privilege; a code-defined DAG cannot. The execution-path **manual loop** (not the auto tool-runner) is what lets the Guardrail check sit between proposal and signable artifact.
- **No assistant prefill** and **`json.loads` on all tool inputs** (never string-match) are required by Opus 4.8 behavior; structured outputs guarantee the policy layer receives well-shaped input to validate rather than free text to parse heuristically.
- **Prompt design for Opus 4.8**: prompts are written as **context, not aggressive `CRITICAL: MUST` directives** — Opus 4.8 follows literal instructions closely and over-aggressive prompts over-trigger. The system prompt states the non-custody invariants and the rule "you propose; you never execute; only Aave v3 and Aerodrome; every action is independently validated," as context — the *enforcement* is the registry + policy layer.

**Caching/cost note**: the large stable per-agent system prompt (role, invariants, allowlist, tool contract) is cached with `cache_control: ephemeral` at the end of the system block; volatile content (current portfolio, mandate, timestamp) goes **after** the cached prefix as message content, never interpolated into the system prompt, and tool order is sorted/deterministic — preserving cache hits across a user's session.

**Invariant preservation**: The orchestrator holds **no keys, generates no wallets, never signs, and has no code path to a SparkPoint-controlled recipient** (N1, N3) — its most powerful output is unsigned calldata in an `IntentBundle`. If the whole service is down, the bundle simply never gets built and the user's on-chain withdraw path is unaffected (N2). The session-key path emits proposals bounded by the same policy layer (N4).

**Alternatives considered**:
- **LangChain/LangGraph orchestration** — rejected for this build; the requirement is a *deterministic* coordinator with hard tool-registry boundaries, which is cleaner to express directly in Python than to constrain a general agent framework. (The constitution names OpenClaw/Hermes.)
- **Fine-tuning Claude on outcomes** — rejected at launch (see §12); the learning loop is retrieval-augmented, not weight-updating.
- **Letting the LLM route between agents** — rejected; gives the model implicit authority over which agent (and thus which tools) runs. The DAG is code.
- **Auto tool-runner on the execution path** — rejected for execution; it would let a build+submit happen without the interposed policy gate. Auto-runner is used only for read-only paths.

**Open questions**: (a) OpenClaw/Hermes is the named framework — confirm its agent/tool abstractions compose cleanly with the Anthropic SDK tool-runner, or treat it as a thin orchestration wrapper around direct SDK calls. **Safe default**: if the framework's tool model conflicts with the deterministic-Coordinator + scoped-registry requirement, use the Anthropic SDK directly behind our own `Coordinator`. (b) Embedding model for pgvector memory — see §7.

---

## 7. Postgres + pgvector (Memory, Outcomes, Embeddings)

**Decision**: A single Postgres instance (Base-only MVP) with `pgvector` enabled, two tiers: **relational** (`users`, `mandates` versioned, `recommendations`, `outcome_log`/`outcome_logs`, `actions`, `policy_evaluations` audit, `citations`, `indexed_positions`, `onchain_events`, `data_source_health`, `context_snapshots`, `risk_events`) and **vector** (`memory_chunks`/`memory_embeddings(user_id, kind, embedding, payload, created_at)`, `kind ∈ {mandate_summary, interaction, strategy_outcome, risk_event, literacy_context}`). All money stored as `numeric(78,0)` raw integer units + a `decimals` companion — never floats. Memory is **per-user scoped** at the query layer (every vector search filtered by `user_id`). Hot reads cached in **Redis** (read-through); decision-time safety reads are **never cached** (always fresh RPC).

**Rationale**:
- pgvector keeps memory/embeddings and relational outcome data in one store (operational simplicity for a solo dev; Principle VII), and lets the recommender's `semantic_memory_search` retrieve a user's relevant history and contextual literacy tips (FR-007) with a single dependency.
- `numeric(78,0)` + `decimals` avoids float drift, which would break the "reconstructable from on-chain" guarantee (Principle III). Float money is a correctness bug, not a style choice.
- **Memory never feeds the policy layer** — the policy layer is deterministic and must not depend on fuzzy recall; a stale embedding can therefore never affect custody or safety. The DB is a **cache/index of chain truth plus the attribution graph**, never the source of truth for balances — if DB and chain disagree, chain wins and the row is re-derived.

**Invariant preservation**: This layer holds **no keys, no secrets, no signed payloads** and has no write path to chain (N1/N3 by construction). All withdraw-relevant math (vault `convertToAssets`, Aave balances) is computable directly from Alchemy RPC, so this layer's failure cannot impede the on-chain escape hatch (N2) — it is an accelerator, not a dependency, for withdrawals.

**Alternatives considered**:
- **Dedicated vector DB (Pinecone/Weaviate/Qdrant)** — rejected; adds a second datastore and network dependency for no launch-scale benefit. pgvector at MVP scale is sufficient (Principle VII).
- **Storing money as floats / DB as source of truth for balances** — rejected; breaks reconstructability (Principle III). Chain is authoritative; DB is an index.
- **Cross-user shared memory** — rejected; every vector search is `user_id`-filtered (no cross-user leakage).

**Open question — embedding model**: store `embedding_model_version` alongside each vector; never mix dimensions/models silently. **Safe default**: a single pinned embedding model at MVP; on a model change, re-embed in a backfill job rather than query across mixed spaces. (Candidate: a hosted embedding API; final choice deferred to implementation.)

---

## 8. Tenderly Pre-Trade Simulation Gate

**Decision**: A **mandatory, fail-closed** simulation gate between "policy-approved candidate tx" and "request signature," applied to **100% of state-changing actions** (SC-002): Aave deposit/withdraw, Aerodrome swap, vault deposit/redeem, and session-key rebalances (simulated at trigger time). Sequence: `buildTx` (unsigned calldata only) → `tenderly.simulate(tx)` → assert `!willRevert` (else block + surface revert reason, FR-023) → assert `outAmount ≥ minOut` (slippage, FR-023) → assert caps OK via on-chain read (FR-025) → render preview (out, fees, price impact, max slippage, balance deltas; FR-021) → only then request the user signature (FR-022). `SimResult { willRevert, revertReason?, outAmount, fees, priceImpactBps, gas, balanceDeltas[] }`.

**Rationale**: The constitution makes "simulation before sign" a hard quality gate (Dev Workflow) and guardrail 4. Tenderly's Simulation API gives a deterministic preview on Base fork state. Putting it inside the single signing chokepoint guarantees SC-002 (a preview before 100% of signature requests). We use **three distinct Tenderly surfaces**: Simulation API (the pre-trade preview), Alerts (on-chain triggers on deployed contracts — large vault flows, pause changes, cap approaches, any call from the deployer address post-deploy, session-key anomalies), and Web3 Actions (serverless responders that *notify* and run periodic withdraw-canary health sims — they never auto-move funds because no such path exists).

**Invariant preservation**: The preview is **advisory** — the authoritative protection is the on-chain `amountOutMin`, caps, and allowlist. A lying frontend cannot induce an out-of-policy on-chain effect because the chain still enforces. **Critically, simulation is never on the withdrawal path** — N2 withdrawals do not depend on Tenderly being up.

**Decision — Tenderly-outage fallback**: if Tenderly is unavailable, **block signing for swaps** (where slippage cannot be locally guaranteed) but fall back to a **local Viem `eth_call`/`estimateGas` dry-run** for deterministic, oracle-free actions (vault deposit/redeem, Aave deposit/withdraw). Rationale: never let an advisory tool's downtime *enable* a riskier path, nor let it *block* the oracle-free custody path. The on-chain max-slippage/caps still backstop everything.

**Alternatives considered**:
- **Local `eth_call`/`estimateGas` as the only simulation** — rejected as primary; it doesn't render the rich balance-delta/price-impact/slippage preview the spec requires (FR-021) and doesn't predict AMM slippage well. Kept only as the oracle-free-path outage fallback.
- **No simulation, rely on on-chain reverts** — rejected; violates the simulation-before-sign gate (Dev Workflow, SC-002) and wastes user gas on predictable reverts.
- **Auto-pause on a Tenderly alert** — rejected; an automated pause-on-alert is a self-DoS vector. Web3 Actions *recommend* a human multisig pause, never auto-execute.

---

## 9. Dune / DeFiLlama / Subgraphs Data Sourcing

**Decision**: Strict **authority ordering — Alchemy RPC > hosted subgraphs > Dune API** — with offchain market data from **DeFiLlama** and prices canonically from **on-chain Chainlink feeds on Base** (with an HTTP price API as display-grade fallback for long-tail tokens, flagged `price_source != onchain`).
- **Alchemy (Base RPC)** — primary/authoritative: point-in-time balances/shares (`balanceOf`, `convertToAssets`, `totalAssets`, Aave `getUserAccountData`), event-log ingestion (`eth_getLogs` over a moving window), block→timestamp. **The fallback path for withdraw-always reconstruction (N2).**
- **Hosted subgraphs (Aave v3, Aerodrome)** — derived/secondary: index history (clean accrued-yield), pool reserves/price history, swap fills.
- **Dune API** — analytics/cross-cutting aggregates only (protocol-wide TVL trend, cohort rollups, DeFiLlama-cross-checked Trust-Center figures); async execute→poll→fetch, TTL-cached, **never on the critical path for an action decision** (rate-limited, eventually-consistent).
- **DeFiLlama** — Aave v3 (Base) supply APY for the "honest net-of-everything APY" display, cross-checked against on-chain Aave liquidity/supply rate so no figure is asserted that DeFiLlama alone claims (avoids the peak-vs-live inflation trap; Principle III).

**Rationale**: An action's safety check (caps, balances, slippage context) must read **live, deterministic** state — subgraphs lag a few blocks and Dune lags minutes — so any pre-sign gate reads fresh from RPC at decision time, not from cache. Reconstructable PnL needs a price whose provenance is on-chain or pinned to a block (Chainlink), because ad-hoc API prices aren't reproducible later (Principle III). Each source carries a `data_source_health` row (`source, last_ok_at, last_block_indexed, latency_ms, status`); on outage, values render **stale/unavailable** and the policy layer blocks execution on data older than the user's tolerance (price-feed-outage edge case).

**Invariant preservation**: All exit-relevant math is computable directly from Alchemy RPC, so a Dune/subgraph/DeFiLlama outage cannot impede the on-chain escape hatch (N2). Trust-Center caps utilization, kill-switch status, and per-account permissions are read **from chain** (PolicyModule, vault caps, kill-switch flag), labeled `as_of_block`, so users can independently reproduce them (N5/Principle III).

**Alternatives considered**:
- **Subgraph or Dune as the authoritative source for safety checks** — rejected; lag makes them unsafe for pre-sign gates. They are enrichment only.
- **Ad-hoc HTTP prices (CoinGecko/DeFiLlama `/prices`) as the canonical PnL price** — rejected for reconstructable PnL; not reproducible at a past block. Chainlink-on-Base is canonical; HTTP is display-grade and flagged. **Safe default**: an asset with no Chainlink feed on Base is marked `best-effort` and excluded from training/outcome attribution.
- **Self-hosted subgraph indexer** — deferred; hosted subgraphs + our own RPC log-ingestion pipeline suffice at launch (Principle VII).

---

## 10. Testnet (Base Sepolia) Strategy

**Decision**: Three environments — `local` (Anvil **fork of Base mainnet** via Alchemy archive URL), `testnet` (**Base Sepolia, chainId 84532**), `mainnet` (Base, chainId 8453). Base Sepolia is the canonical testnet for integration, E2E, and session-key/policy verification, deployed automatically from merges to `main` via `deploy-testnet.yml`. Where an integration target is **missing or unreliable on Base Sepolia** (Aave v3 / Aerodrome deployments), the corresponding suite runs against the **local Base-mainnet fork** instead, and the gap is recorded here (see open question). Per-environment addresses live in a checked-in typed registry (`packages/shared/src/addresses/{base,baseSepolia,localFork}.ts`) consumed by web, agent, and Foundry scripts — one source of truth. Mainnet deploy is gated (manual approval env + `AUDIT_SIGNOFF` + hardware-wallet signing + arm-caps/arm-kill-switch/renounce/assert sequence).

**Rationale**:
- Forking Base mainnet locally gives **real Aave/Aerodrome pool/router behavior** for fork tests and simulation — those protocols are too large to faithfully redeploy locally. Pin a fork block in CI for determinism; allow `latest` locally.
- The **closed alpha on Base mainnet *is* staging** (caps + whitelist + kill-switch), per the constitution's "real funds only behind beta gating via a small closed alpha." A separate mainnet staging would dilute that single well-guarded surface.
- A `non-custody-invariants` CI job runs the Foundry invariant/fuzz suite asserting N1 (no admin-withdraw path), N2 (`redeem`/`withdraw` succeed while `paused`), N4 (no session-key UserOp exceeds caps/expiry/allowlist), and N5 (vault non-upgradeable, governance pause-only) on every contracts change — a failing invariant **blocks merge and blocks testnet deploy** (Dev Workflow gate).

**Invariant preservation**: The W7 internal testing explicitly runs the **withdraw-always-offline drill** (frontend + agents down + kill-switch paused) — `test_withdrawWorks_whenPaused_andOffline` (N2/SC-003) — plus per-invariant scripts. The mainnet deploy's post-deploy assertion script reads on-chain and **fails the pipeline** if the deployer holds any admin role, pause authority isn't the multisig, or any non-custody invariant isn't provable (makes SC-004 true on-chain).

**Alternatives considered**:
- **Bespoke local redeploy of Aave/Aerodrome** — rejected; not faithful to real protocol behavior. Fork instead.
- **A shared mainnet "staging" environment with real funds** — rejected; the closed alpha is the single guarded real-funds surface (constitution). A second one dilutes the guardrails.
- **CI-resident mainnet deployer key** — rejected; unacceptable blast radius. Mainnet deploys are hardware-wallet-signed (`forge script --ledger`), and the deployer renounces all privileged roles in the same broadcast (SC-004).

**Open question (record the gap here per devops design)**: confirm Aave v3 and Aerodrome have usable Base Sepolia deployments at build time. **Safe default**: any suite whose protocol target is missing/unreliable on Sepolia runs against the pinned local Base-mainnet fork, and the specific missing target is documented in this file when discovered.

---

## 11. Caps, Kill-Switch, and Verifiable Non-Custody (Cross-Cutting)

**Decision**: Three caps — per-user TVL, total protocol, vault deposit — all enforced **on-chain** (authoritative) via `CapRegistry` + the vault's `maxDeposit` override, with an off-chain pre-check for UX (block before signing, FR-025/SC-009). `CapRegistry` params are multisig-settable **only within hard-coded max bounds** (a compromised multisig can't open caps to infinity); **caps never gate withdrawals**. The kill-switch is an immutable `Pausable` with `pause()`/`unpause()` gated to a **multisig (≥2-of-N, no single SparkPoint signer can pause alone), whose only powers are pause/unpause** — it has no fund-movement role at all. A vault-level deposit-side **circuit-breaker** (reject deposits if share price moves outside a sane band) is in scope; it never gates withdraw. Verifiable non-custody is surfaced by the Trust Center reading **exact on-chain permissions straight from chain** (account `owner()`, vault `paused()`/`guardian()`/`pauser()`, active session policies, the protocol allowlist, `capRegistry.*`) — plus a generated **permissions manifest** (`trust/permissions.json`) and a **withdraw-always runbook** (explorer-only steps).

**Rationale**: Caps + kill-switch + circuit-breaker bound the blast radius (Principle IV, guardrails 2/3). The "PAUSE-ONLY, withdrawals never blocked" semantics are the operationalization of N2 + the constitution's kill-switch rule. Surfacing permissions from chain (never from our DB) makes non-custody **independently verifiable** (N5, FR-038, SC-004/SC-012) — a third party can reproduce every check with a block explorer / `cast`.

**Invariant preservation**: Directly realizes N5 (governance pause-only, never fund movement; provable from state) and N2 (pause subtracts only *new risk*, never *exit*). The bounded-cap-params decision keeps even a compromised multisig fund-neutral (N1/N5).

**Alternatives considered**:
- **Fully immutable caps (no adjustability)** — the safe-default baseline for maximum non-custody clarity; if adjustability is required it lives behind the same pause-only multisig as a *cap parameter only*, never a fund path. **Decision**: conservative fixed caps for closed alpha, raised by redeploy/parameter-set within bounds as confidence grows.
- **Automated kill-switch (auto-pause on anomaly)** — rejected; a self-DoS vector. Alerts notify; a human multisig pauses.
- **Trust Center reading permissions from our DB** — rejected; that would make non-custody an assertion, not a proof. Read straight from chain (Principle III).

**Open question (owned by SparkPoint, not this build)**: exact multisig membership/threshold and the legal list of geo-restricted regions are operational/legal choices. **Safe default in code**: ≥2-of-N pause-only multisig; geo-fence *mechanism* implemented at the edge (the *list* is supplied by SparkPoint's legal team).

---

## 12. Outcome-Logging / PnL-Attribution Data Model

**Decision**: Establish the recommendation→tx→position→PnL link **at proposal time, not guessed afterward**. When the recommender proposes, write a `recommendations` row and mint an `intent_action_id` (UUID). Carry it through execution as a deterministic on-chain tag: **primary mechanism** is a dedicated `IntentLog` event emitted by the `SparkPointAccount`/executor path keyed `(intent_action_id, user, target, selector)`; **guaranteed fallback** is heuristic matching by `(sender smart_account, target, selector, asset, amount, block window)` from indexed `onchain_events`. Index both, prefer the event, store which was used in `attribution_method`. On confirmation, populate `outcome_logs.resulting_txs`, `entry_block`, `entry_value_usd`, and a frozen `entry_price_snapshot` (Chainlink @ block). A periodic attribution worker updates realized/unrealized PnL, stamped `pnl_as_of_block`. The training dataset is a deterministic join `context_snapshots ⋈ recommendations ⋈ outcome_logs ⋈ feedback ⋈ risk_events` yielding labeled, block-anchored, look-ahead-free tuples. **No fine-tuning at launch** — the learning loop is retrieval-augmented (labeled outcomes fed back as retrieved context), not weight-updating.

**Rationale**: Anchoring entry to a block number + a pinned price snapshot whose inputs are logged makes every PnL number **reproducible by replaying `onchain_events` + the snapshot** — no trust in our DB required (Principle III, SC-010). Because the vault is 0-fee, vault yield = pure Aave accrual with no fee term to subtract; every figure subtracts gas (from the receipt) and realized slippage, matching what actually happened on-chain (honest-yield mandate). RAG-over-outcomes is faster to ship than fine-tuning, fully inspectable, and avoids opaque model drift — the right call for a solo dev on a 12-week timeline (Principle VII), and it keeps recommendations explainable (Principle III).

**Invariant preservation**: This layer is read/derive only — no keys, no signing, no chain-write path (N1/N3). It is not on the withdrawal path (N2). `policyVersion` + the `policy_evaluations`/`policy_evaluations` audit table let the Trust Center state exactly which off-chain ruleset ran (N5).

**Attribution edge-case decisions**: user-initiated action with no recommendation → `recommendation_id = null`, still logged (portfolio reconciles) but excluded from recommender-performance rollups. One rec → multiple txs (approve + deposit) → all hashes in `resulting_txs`, entry value from the value-moving tx. Partial close → `status = partially_closed`, realized PnL accrues proportionally using **average-cost** basis (decision: average-cost not FIFO at MVP — simpler, adequate for a single conservative vault; revisit for multi-strategy). Unmatchable tx → `attribution_method = 'unmatched'`, surfaced in source-health, never silently attributed.

**Alternatives considered**:
- **Heuristic-only attribution** (no `IntentLog` event) — kept as the guaranteed fallback so the contract surface can stay minimal if the internal audit prefers it; but the on-chain event gives provable linkage when present. **Decision**: support both, record `attribution_method`. (`IntentLog` is a new interface this layer requests from the Onchain domain.)
- **Fine-tuning Claude on outcomes at launch** — rejected; opaque drift, slower to ship, harder to audit than RAG (Principle III/VII). **Safe default if outcome data is sparse**: recommender falls back to mandate + live market data alone.
- **FIFO cost basis** — rejected at MVP for complexity; average-cost is adequate for one vault.

**Open question**: `IntentLog` event vs heuristic-only is partly an audit-preference call (does the minimal contract surface outweigh provable linkage?). **Safe default**: ship both; let the internal audit decide whether to drop the event.

---

## Cross-Cutting Conclusions

1. **The deterministic floor is on-chain; everything above is advisory and fail-closed.** AI (§6), the off-chain policy mirror (§5), and Tenderly (§8) can only over-block; `PolicyModule`/`SessionKeyValidator`/vault caps/the non-upgradeable vault hold even if every off-chain layer is bypassed. This is what makes "the AI never has the final word" structural, not a promise (Principle II).
2. **Withdraw survives total infra loss (N2).** Vault `redeem`/`withdraw` carry no pause modifier and call Aave directly; all exit math is computable from raw Alchemy RPC; no off-chain service, oracle, agent, paymaster, or simulation tool is on the withdrawal path. SC-003 is a machine-checked invariant (`test_withdrawWorks_whenPaused_andOffline`).
3. **No SparkPoint key ever moves funds (N1, N5).** No admin asset-movement selector exists on the vault; session keys force recipient = the account; the only SparkPoint-held key is a pause-only multisig within hard-bounded cap params. SC-004 is asserted on-chain at deploy.
4. **The fallback (§1) is decoupled by design.** Vault, adapters, caps, and kill-switch are SDK-agnostic, so a ZeroDev/Kernel swap touches only the account/validator/policy trio and is re-verified against N1–N5 before adoption.

## Consolidated Open Questions (carry into Phase 1 / build)

| # | Open question | Safe default |
|---|---|---|
| OQ-1 | Account upgradeability: owner-only UUPS vs fully immutable (§1) | Owner-only UUPS; immutable under schedule pressure. Vault always non-upgradeable. |
| OQ-2 | Alchemy Bundler v0.7 support + EntryPoint v0.7 singleton address on Base (§2) | Pin addresses in deploy config; v0.6 + Pimlico as fallback; verify in tests. |
| OQ-3 | Aave-ETH path via `WrappedTokenGatewayV3` (Base gateway address) (§3) | USDC-only vault is the must-have; ETH behind a flag once gateway confirmed. |
| OQ-4 | OpenClaw/Hermes composition with the Anthropic SDK tool-runner (§6) | Use the SDK directly behind our deterministic Coordinator if the framework conflicts. |
| OQ-5 | Embedding model + version for pgvector (§7) | One pinned model + version stamp; backfill on change. |
| OQ-6 | Aave v3 / Aerodrome availability on Base Sepolia (§10) | Run affected suites against the pinned local Base-mainnet fork; document the gap here. |
| OQ-7 | Multisig membership/threshold + geo-restricted region list (§11) | ≥2-of-N pause-only multisig; geo-fence mechanism only — region list owned by SparkPoint legal. |
| OQ-8 | `IntentLog` event vs heuristic-only attribution (§12) | Ship both; record `attribution_method`; internal audit decides whether to keep the event. |

## Constitution Alignment Check (Phase 0)

| Principle | How this research conforms |
|---|---|
| I — Non-custodial by construction | Every custody-touching decision (§1–§5, §11, §12) states N1–N5 preservation; the fallback re-verifies all five before adoption. |
| II — AI proposes, deterministic policy + user disposes | §5 (LLM-free policy layer in front of the signable artifact + on-chain backstop) and §6 (deterministic Coordinator, scoped tool registries, manual loop on the execution path). |
| III — Provable, not promised | §8 (preview advisory, chain authoritative), §9 (Chainlink-anchored reconstructable PnL, DeFiLlama cross-checked), §11 (Trust Center reads from chain), §12 (block-anchored reproducible PnL). |
| IV — Security & bounded blast radius | Six guardrails mapped: G1 §5, G2/G3 §11, G4 §8, G5 §3/§4/§5, G6 §3; session-key compromise containment §4. |
| V — Conservative, transparent launch | §3 (single 0-fee non-upgradeable Aave vault, bytecode-level 0-fee); §12 (yield = Aave accrual only, no token incentives). |
| VI — Spec-driven | Every decision traces to FR-/SC-/named contracts; this doc resolves Phase-0 unknowns before plan/tasks. |
| VII — Simplicity & YAGNI | Single chain/single vault; managed bundler (§2); pgvector over a separate vector DB (§7); RAG over fine-tuning (§12); the named AA fallback (§1). |
