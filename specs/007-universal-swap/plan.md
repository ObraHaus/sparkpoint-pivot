# Implementation Plan: Universal Swap

**Branch**: `007-universal-swap` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-universal-swap/spec.md`

## Summary

Turn the fixed ETH↔USDC swap (a single `ethToUsdc` boolean, single-hop only) on `/swap` and the in-chat
swap card into a universal, DEX-aggregator-style surface: ETH + USDC stay as one-tap recommended tokens,
but a user can paste **any ERC-20 address on either leg**. The app resolves token metadata on-chain, routes
single-hop **and** multi-hop (via WETH / USDC), and keeps the **0.20% routing fee** taken on-chain inside
the user's own signed swap — now on **every** supported network, not only where a vault exists. The swap
stays user-signed, non-custodial, and **outside** the deterministic policy engine, exactly as today's
Uniswap/Synthra path already is.

Technical approach (from research.md): extend the existing swap library (`apps/web/src/lib/swap/*`) rather
than replace it — add on-chain token resolution, path encoding + a route selector, a per-network
`swapFeeRecipient`, and a token-generic resolver shared by `/swap` and the chat card; add a token-pair
field to the assistant's proposed-action wire. No new on-chain contract; no change to the vault, AA stack,
session keys, or policy allowlist.

## Technical Context

**Language/Version**: TypeScript 5 (Next.js 15 App Router, React 19) for `apps/web`; Python 3.12 for
`services/agent`; Solidity (Foundry) unaffected except a read-only on-chain probe.

**Primary Dependencies**: viem 2 + wagmi 2 (on-chain reads + user-signed writes), `@tanstack/react-query`
(quote caching), `@sparkpoint/shared` (per-chain address book + wire schemas), Zod (wire schema). No new
runtime dependency is expected.

**Storage**: none server-side. Client `localStorage` for the per-network imported-token list
(`sp.swap.imported.v1`). No DB migration.

**Testing**: `node:test` for pure units (path encoding, fee/slippage math, metadata parsing, route
selection); Vitest/RTL where component tests already exist; Playwright e2e under `apps/web/e2e/pw` (new).
Python `pytest` for the agent proposal changes.

**Target Platform**: Web (desktop + mobile), the same alpha deployment on Coolify dev/staging.

**Project Type**: Web application (Next.js frontend + Python agent service + shared TS package).

**Performance Goals**: keep quote fan-out bounded on the CPU-starved dev box + free RPC — prune multi-hop
candidates and debounce so a quote refresh stays within a few RPC round-trips, not tens.

**Constraints**: fail-closed honesty (no fabricated quotes); non-custodial (user is sole signer +
recipient); the displayed fee always equals the collected fee; on-chain `decimals` authoritative for both
legs; `feeBips ≤ 100` (Uniswap on-chain cap).

**Scale/Scope**: 3 networks (8453, 84532, 46630); ~2 recommended tokens + unbounded pasted tokens; two
swap surfaces (`/swap` + inline chat card) sharing one resolver; one wire-schema field added.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.3.0.

| Principle | Assessment |
|---|---|
| **I. Non-Custodial by Construction (N1–N5, NON-NEGOTIABLE)** | **PASS.** The swap is user-signed; the recipient is always the connecting account; the 0.20% fee is split on-chain to a disclosed recipient and never held by SparkPoint (N1, N3). No vault / withdraw path is touched (N2, N5). No session key or automation is added (N4). No custody semantics change. |
| **II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)** | **PASS.** The assistant only *proposes* a token pair; execution is user-signed client-side and is NOT routed through the agent's policy/execution path. No `Asset` enum, `TargetRef`, or `(target,selector)` allowlist is widened (FR-024). A malicious/injected proposal cannot move funds without the user signing, and it is treated as unverified by default. |
| **III. Provable, Not Promised** | **PASS.** All figures are live on-chain quotes labeled "estimated"; the routing-fee recipient is disclosed on `/fees` per network; no return projections; fee never touches principal (it is a swap-output split, not a vault fee). |
| **IV. Security & Bounded Blast Radius** | **PASS with a recorded scope note (below).** No new custodial contract; the surface stays user-signed. Guardrail #5 ("only Aave v3 + Aerodrome … impossible by construction") governs the **agent/vault policy-gated execution path** — the manual swap is neither, and already runs on Uniswap/Synthra V3 today. See Complexity Tracking. |
| **V. Conservative, Transparent Launch** | **PASS.** The vault and its fee model are untouched. The routing fee is a pre-existing, disclosed 0.20% swap-routing fee (distinct from the vault performance fee); this feature changes its *reach*, not the vault. |
| **VI. Spec-Driven Development (NON-NEGOTIABLE)** | **PASS.** This plan follows spec → plan → tasks; no code lands before tasks exist; artifacts trace to the spec. |
| **VII. Simplicity & YAGNI** | **PASS.** Extends the existing swap library rather than adding a routing service or aggregator SDK; multi-hop is bounded to WETH/USDC hops; no speculative generality. |

**Recorded scope note (Guardrail IV.5 — whitelisted protocols).** The constitution's "only Aave v3 and
Aerodrome, impossible by construction" is a bound on the **deterministic-policy / vault execution path**
(what the *agent* and the *vault* can touch with custodied funds). The manual/chat swap is a **user-signed
EOA action outside that boundary** — the address registry already documents the Uniswap V3 router/quoter as
plain fields that are *not* policy `TargetRef`s, and the shipped ETH↔USDC swap already executes via
Uniswap/Synthra (not Aerodrome). This feature **broadens the token set** of that already-outside-policy
surface; it does not widen what the policy engine or vault can reach. This is client/operator-directed
(2026-07-20) and is recorded here for governance visibility; it does not weaken N1–N5, Principle II, or the
kill-switch, so no re-ratification is required. If the operator wants the constitution to explicitly name
this user-signed DEX surface, that is a follow-up wording amendment (like the v1.3.0 vendor-neutral one),
tracked separately.

**Result: GATE PASS** — proceed to Phase 0. No unresolved NON-NEGOTIABLE violations.

## Project Structure

### Documentation (this feature)

```text
specs/007-universal-swap/
├── plan.md              # This file
├── spec.md              # WHAT/WHY (already written)
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — entities & shapes
├── quickstart.md        # Phase 1 — how to run/verify locally
├── contracts/           # Phase 1 — internal interface contracts (wire schema, route/exec shapes)
│   └── swap-interfaces.md
└── tasks.md             # Phase 2 — /speckit-tasks output (task list)
```

### Source Code (repository root)

```text
apps/web/src/lib/swap/                 # the swap library (extended, not replaced)
├── tokens.ts            # recommended list + SwapToken type (extended: source/verified/name)
├── tokenList.ts         # NEW — curated verified-token map per chain (badges only, not a gate)
├── importedTokens.ts    # NEW — per-chain localStorage imported/recent list
├── metadata.ts          # NEW — resolveErc20(): on-chain symbol/decimals/name (+bytes32, sanitize)
├── path.ts              # NEW — Uniswap V3 path encoding (pure, byte-exact)
├── route.ts             # NEW — candidate enumeration + best-route selection (single + multi-hop)
├── dex.ts               # (existing) DEX metadata — reconcile the manual selector vs auto-route
├── abis.ts              # add quoteExactInput / exactInput
├── math.ts              # unchanged fee/slippage math (ROUTING_FEE_BIPS = 20)
├── useSwapQuote.ts      # consume route.ts; path-aware price impact
├── useExecuteSwapTx.ts  # SwapExec gains `path`; multi-hop + universal-fee execution + approve-to-zero
└── useSwapConfirm.ts    # token-generic resolver shared by BOTH surfaces (tokenIn/tokenOut, not boolean)

apps/web/src/components/screens/swap/
└── TokenPicker.tsx      # NEW — recommended / imported / paste-address picker with safety badges

apps/web/src/app/(app)/swap/page.tsx   # token pickers replace the boolean; consumes the shared resolver
apps/web/src/app/(app)/fees/page.tsx   # disclose per-chain routing-fee recipient; "every network" copy
apps/web/src/app/(app)/confirm/…       # ConfirmFlow: de-hardcode ETH/USDC swap copy

apps/web/src/components/screens/chat/
├── inline-swap-confirm.tsx  # carries a token pair, not ethToUsdc; safety badges at the signing gate
├── live-blocks.tsx          # inlineIntentFor forwards the proposed pair (+ old-shape fallback)
└── cards.tsx                # mock offline SwapCard goes generic

packages/shared/src/addresses/
├── types.ts             # add optional swapFeeRecipient?: Address (plain field, NOT a policy TargetRef)
├── base.ts · baseSepolia.ts · robinhoodTestnet.ts   # populate swapFeeRecipient per chain
packages/shared/src/schemas/action.ts # ProposedActionSchema gains tokenIn/tokenOut/chainId (additive)

services/agent/src/sparkpoint_agent/
├── agents/planner.py    # extract tokenIn/tokenOut as symbol-or-0xADDRESS; don't null custom tokens
├── coordinator/dag.py   # emit a real pair (address+decimals-deferred) + chainId; stay outside policy
└── coordinator/chat_blocks.py  # proposed_action_wire carries the pair

Living docs: CHANGELOG.md · DEVELOPMENT.md (swapFeeRecipient + localStorage key) ·
services/agent/content_seed/whats-new.json (client-facing per-phase entries)
```

**Structure Decision**: Web-application layout (Next.js frontend + Python agent + shared TS package). The
feature is concentrated in `apps/web/src/lib/swap/*`; the agent + shared-schema changes are a thin, additive
seam. No new top-level project.

## Phased design (maps to spec user stories)

Each phase is independently shippable to `develop` and honest at its own boundary.

- **Phase 0 — De-duplicate the resolver (groundwork, no behavior change).** `/swap/page.tsx` has its own
  quote/fee/exec logic and does not import `useSwapConfirm`; only the chat card does. Unify onto one
  token-generic resolver so every later change lands once. Guarded by the honest-state matrix.
- **Phase A → US1.** Token model + `TokenPicker` + `resolveErc20` (bytes32 symbol, is-contract +
  `decimals()` gate, sanitize), per-chain imported list, generalized balance/allowance/approve
  (incl. approve-to-zero), signing-gate safety badges. Still single-hop.
- **Phase B → US2.** `quoteExactInput`/`exactInput` ABIs, `path.ts`, `route.ts` (direct×tiers + 2-hop via
  WETH/USDC, prune + debounce, best-output, fail-closed), `path`-aware execution + price impact,
  chain-switch reset.
- **Phase C → US3.** `swapFeeRecipient` per chain; synchronous fee-gate (`feeExpected`) that blocks until
  the recipient resolves; reject zero recipient; on-chain probe of Synthra `*WithFee` + multi-hop fns on
  46630 with an honest fallback; `/fees` update.
- **Phase D → US4.** `ProposedActionSchema` pair + `chainId` (additive, web-tolerant of old shape first);
  agent proposes a real pair; inline card + `inlineIntentFor` carry it; mock card generic.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Multi-hop routing (`path.ts` + `route.ts`) | "Universal" is not real if most pasted pairs return "no route" — arbitrary pairs rarely share a direct pool | Single-hop only would make the feature misleading; a third-party aggregator SDK/API adds a trust+custody surface and a runtime dependency, violating Principle VII |
| Per-chain `swapFeeRecipient` (new address-book field) | The fee must apply on non-vault networks (US3); today it is sourced only from `vault.feeRecipient()` | Keeping the vault-only source leaves 46630 permanently fee-free, contradicting the brief; reusing the vault where absent is impossible (no vault to read) |
| Broadening the user-signed swap token set beyond ETH/USDC (Guardrail IV.5 scope note) | Operator-directed; the surface is already outside the policy/vault boundary the guardrail governs | Restricting to ETH/USDC keeps the fixed toggle and fails the feature's entire purpose; the guardrail is preserved where it actually binds (agent/vault path) |
