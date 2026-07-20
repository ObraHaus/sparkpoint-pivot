---
description: "Task list for 007-universal-swap"
---

# Tasks: Universal Swap

**Input**: Design documents in `specs/007-universal-swap/` (spec.md, plan.md, research.md, data-model.md,
contracts/swap-interfaces.md, quickstart.md)

**Tests**: Included — this feature moves user funds and adds an attacker-controlled input surface, so the
pure engines (path/route/metadata/fee-gate) and the honest-state matrix are tested. Requested in the spec.

**Organization**: Grouped by user story (US1–US4 from spec.md) so each ships independently to `develop`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1 / US2 / US3 / US4 (or SETUP / POLISH)

## Definition of Done (every SparkPoint feature)

A task-group / phase is "done" only when:

- [ ] `CHANGELOG.md` — a dev bullet under `## [Unreleased]` for any behavior/schema/infra change (the new
      `swapFeeRecipient` field, wire-schema fields, multi-hop, fee-everywhere all qualify).
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry for each user-visible phase
      (A: custom tokens, B: any-to-any routing, C: fee on all networks, D: chat parity), stable `slug`.
- [ ] `DEVELOPMENT.md` documents every new config: the `swapFeeRecipient` address-book field + the
      `sp.swap.imported.v1` localStorage key.
- [ ] `changelog-required` CI green (or `skip-changelog` + justification); `pnpm -w typecheck && lint &&
      build` green; new unit tests green; non-custody invariants confirmed in review (Constitution I/II).
- [ ] No new env var undocumented; no new agent seed dir without an explicit `COPY` in
      `services/agent/Dockerfile` (none expected this feature).

---

## Phase 0: Groundwork — one shared resolver (no behavior change)

**Purpose**: `/swap/page.tsx` duplicates the quote/fee/exec logic that the chat card gets from
`useSwapConfirm`. Unify so every later change lands once. Ships alone; guarded by the honest-state matrix.

- [ ] T001 [SETUP] Extract `/swap/page.tsx` inline quote/fee/exec into `useSwapConfirm` so both surfaces
      consume one resolver; keep `ethToUsdc` for now (pure refactor). Files:
      `apps/web/src/app/(app)/swap/page.tsx`, `apps/web/src/lib/swap/useSwapConfirm.ts`.
- [ ] T002 [SETUP] Manually walk the honest-state matrix (quickstart.md) on `/swap` + chat to confirm zero
      behavior change.
- [ ] T003 [P] [SETUP] `CHANGELOG.md` — `## [Unreleased]` bullet: "refactor(web): unify swap resolver".

**Checkpoint**: one resolver; `/swap` + chat behave exactly as before.

---

## Phase A → User Story 1 — Swap into any token (direct pool) (Priority: P1) 🎯 MVP

**Goal**: paste a custom ERC-20 (either leg), resolve it on-chain safely, quote + sign a single-hop swap
with the 0.20% fee and signing-gate safety.

**Independent Test**: quickstart US1.

### Tests for US1 (write first, ensure they fail)

- [ ] T004 [P] [US1] `metadata.test.ts` — normal ERC-20, `bytes32` symbol, reject non-contract, reject
      missing `decimals()`, reject `decimals > 36`, sanitize homoglyph/zero-width/over-long, truncated-
      address fallback. In `apps/web/src/lib/swap/metadata.test.ts`.
- [ ] T005 [P] [US1] Fee-gate unit — recipient pending ⇒ `exec` undefined (blocks), zero recipient ⇒ fee
      not activated, unset+no-vault ⇒ no fee shown. In `apps/web/src/lib/swap/useSwapConfirm.test.ts`
      (mocked reads).

### Implementation for US1

- [ ] T006 [P] [US1] `metadata.ts` — `resolveErc20()` + `sanitizeMetaString()` per
      contracts/swap-interfaces §1 (viem multicall `allowFailure`, bytes32 fallback, is-contract +
      decimals gate, clamp, in-memory cache). New `apps/web/src/lib/swap/metadata.ts`.
- [ ] T007 [P] [US1] `tokenList.ts` — curated per-chain verified-token map (canonical USDC/WETH + a few
      Base majors). Badges only, not a gate. New `apps/web/src/lib/swap/tokenList.ts`.
- [ ] T008 [P] [US1] `importedTokens.ts` — per-chain `localStorage` list (`sp.swap.imported.v1`, LRU~20,
      SSR-guarded). New `apps/web/src/lib/swap/importedTokens.ts`.
- [ ] T009 [US1] Extend `SwapToken` (`name`, `source`, `verified`); rename recommended getter; keep
      `isConfiguredToken`; add `isSameToken`/native↔WETH mapping. `apps/web/src/lib/swap/tokens.ts`
      (depends on T007).
- [ ] T010 [US1] `TokenPicker.tsx` — Recommended / Imported sections + paste-address (calls `resolveErc20`,
      shows symbol/name/decimals + verified/unverified + duplicate-symbol-by-address warning + Import).
      New `apps/web/src/components/screens/swap/TokenPicker.tsx` (depends on T006–T009).
- [ ] T011 [US1] Generalize `useSwapConfirm`: params `ethToUsdc` → `tokenIn`/`tokenOut`; generic balance
      (native vs any ERC-20), allowance + `needsApprove` for any non-native `tokenIn`, approve-to-zero flag;
      **synchronous** `feeExpected` gate + reject-zero-recipient (contracts §4).
      `apps/web/src/lib/swap/useSwapConfirm.ts` (depends on T009).
- [ ] T012 [US1] `useExecuteSwapTx` — approve-to-zero two-leg state in `SwapExecStage`; generic ERC-20-in.
      `apps/web/src/lib/swap/useExecuteSwapTx.ts` (depends on T011).
- [ ] T013 [US1] `/swap/page.tsx` — replace the `ethToUsdc` boolean with `tokenIn`/`tokenOut` + two
      `TokenPicker`s + flip; **signing-gate safety**: address + verified/unverified badge + "I understand"
      gate for an unverified receive-token; amount seeded from `tokenIn.decimals`.
      `apps/web/src/app/(app)/swap/page.tsx` (depends on T010–T012).
- [ ] T014 [US1] `/confirm/[intent]` ConfirmFlow — de-hardcode ETH/USDC swap copy (generic from/to).
      `apps/web/src/app/(app)/confirm/…`.
- [ ] T015 [P] [US1] Living docs: `CHANGELOG.md` bullet + `whats-new.json` client entry ("Swap into any
      token") + `DEVELOPMENT.md` (imported-token key).

**Checkpoint**: custom-token swaps work for direct-pool pairs, both legs, with signing-gate safety.

---

## Phase B → User Story 2 — Any-to-any via best-route (Priority: P2)

**Goal**: single-hop **and** multi-hop (via WETH/USDC), auto best-route, honest states, chain-switch reset.

**Independent Test**: quickstart US2.

### Tests for US2 (write first)

- [ ] T016 [P] [US2] `path.test.ts` — byte-exact direct (43B) + 2-hop (66B), native→WETH substitution
      position. `apps/web/src/lib/swap/path.test.ts`.
- [ ] T017 [P] [US2] `route.test.ts` — best-of-candidates, prune rules, `noRoute` when all revert,
      transport-error ⇒ `error` not `noRoute`, native normalized before prune.
      `apps/web/src/lib/swap/route.test.ts`.

### Implementation for US2

- [ ] T018 [P] [US2] `abis.ts` — add `quoteExactInput` (array outputs) + `exactInput`
      (contracts §5). `apps/web/src/lib/swap/abis.ts`.
- [ ] T019 [P] [US2] `path.ts` — `encodeDirect` / `encodeTwoHop` (pure). New `apps/web/src/lib/swap/path.ts`.
- [ ] T020 [US2] `route.ts` — enumerate direct×tiers + 2-hop via WETH/USDC, prune + debounce, best output,
      fail-closed; expose `RouteResult`. New `apps/web/src/lib/swap/route.ts` (depends on T018, T019).
- [ ] T021 [US2] `useSwapQuote.ts` — consume `route.ts`; path-aware price-impact reference (re-quote along
      the winning route; low-decimal/thin-hop ⇒ "unavailable"). `apps/web/src/lib/swap/useSwapQuote.ts`
      (depends on T020).
- [ ] T022 [US2] `useExecuteSwapTx.ts` — `SwapExec.path`; `exactInput` encode for multi-hop; fee-leg
      unchanged (gross floor to pay-leg); no-fee native-out uses `ADDRESS_THIS` + `unwrapWETH9(minOut)`.
      `apps/web/src/lib/swap/useExecuteSwapTx.ts` (depends on T020).
- [ ] T023 [US2] `useSwapConfirm.ts` — thread `RouteResult` into `SwapExec`; multi-hop slippage warning
      (surface, don't silently loosen). `apps/web/src/lib/swap/useSwapConfirm.ts`.
- [ ] T024 [US2] Chain-switch reset: on `useChainId` change reset `tokenIn/tokenOut` to that chain's
      recommended defaults + re-scope imported list. `apps/web/src/app/(app)/swap/page.tsx`.
- [ ] T025 [US2] Retire the manual "Route via" DEX `Seg`; render an honest auto-route summary
      (`TOKEN → WETH → USDC · fee`), venue honest per chain. `apps/web/src/app/(app)/swap/page.tsx`,
      `apps/web/src/lib/swap/dex.ts`.
- [ ] T026 [P] [US2] Living docs: `CHANGELOG.md` + `whats-new.json` ("Swap between any two tokens").

**Checkpoint**: arbitrary pairs route + swap; honest states hold; network switch is safe.

---

## Phase C → User Story 3 — 0.20% fee on every supported network (Priority: P2)

**Goal**: fee applies on all networks where collectible on-chain; synchronous gate; `/fees` truthful.

**Independent Test**: quickstart US3.

### Tests for US3 (write first)

- [ ] T027 [P] [US3] Integration — `swapFeeRecipient` set ⇒ fee path; unset+vault ⇒ vault fallback;
      unset+no-vault ⇒ no fee shown; recipient pending ⇒ blocked; zero recipient ⇒ inactive. Mocked viem.
      `apps/web/src/lib/swap/fee.integration.test.ts`.

### Implementation for US3

- [ ] T028 [US3] On-chain probe (read-only) of Synthra 46630 `SwapRouter02`/`QuoterV2` for
      `unwrapWETH9WithFee`, `sweepTokenWithFee`, `exactInput`, `quoteExactInput` (script under
      `scripts/` or a one-off). Record the result in research.md → decide in-swap split vs fee-on-input vs
      fee-free. **Gates T030 for 46630.**
- [ ] T029 [US3] Add `swapFeeRecipient?: Address` to `AddressBook` (plain field, NOT a `TargetRef` — no
      `TARGET_REF_FIELD` change). `packages/shared/src/addresses/types.ts`.
- [ ] T030 [US3] Populate `swapFeeRecipient` in `base.ts` / `baseSepolia.ts` / `robinhoodTestnet.ts` per the
      probe + operator-chosen treasury. `packages/shared/src/addresses/*.ts` (depends on T028).
- [ ] T031 [US3] Fee resolution in the shared resolver: `feeRecipient = swapFeeRecipient ?? vaultRead`;
      synchronous `feeExpected`; reject-zero; on non-collectible networks show no fee.
      `apps/web/src/lib/swap/useSwapConfirm.ts` (depends on T029).
- [ ] T032 [US3] (only if probe says fee-on-input) implement the fee-on-input path for 46630
      (`amountIn × 0.998` + separate fee transfer). `apps/web/src/lib/swap/useExecuteSwapTx.ts`.
- [ ] T033 [US3] `/fees` — disclose the routing-fee recipient for the **active** network (not hardcoded
      84532); reconcile "never on the vault" wording; state the fee applies on every supported network.
      `apps/web/src/app/(app)/fees/page.tsx`, `apps/web/src/components/screens/fees.css` if needed.
- [ ] T034 [P] [US3] Living docs: `CHANGELOG.md` + `whats-new.json` ("Routing fee now applies on every
      network") + `DEVELOPMENT.md` (`swapFeeRecipient`).

**Checkpoint**: fee is consistent + truthful on all networks; displayed fee == collected fee.

---

## Phase D → User Story 4 — Same custom swap in chat (Priority: P3)

**Goal**: assistant proposes a real token pair; inline card reuses the engine with the same fee + safety.

**Independent Test**: quickstart US4.

### Tests for US4 (write first)

- [ ] T035 [P] [US4] Wire-schema back-compat — old single-asset block still parses + falls back to
      ETH↔USDC; new pair block forwards; unverified rendering. TS in `packages/shared` +
      `apps/web/.../live-blocks.test.tsx`.
- [ ] T036 [P] [US4] Python — `dag.py` emits a valid pair block; `planner.py` extracts a 0x-address token
      without nulling it. `services/agent/tests/coordinator/…`, `services/agent/tests/agents/…`.

### Implementation for US4

- [ ] T037 [US4] `ProposedActionSchema` — additive optional `tokenIn`/`tokenOut`/`chainId`; keep `asset`;
      **deploy web first, tolerant of old shape**. `packages/shared/src/schemas/action.ts`.
- [ ] T038 [US4] Python mirror `proposed_action_wire` — carry the pair.
      `services/agent/src/sparkpoint_agent/coordinator/chat_blocks.py`.
- [ ] T039 [US4] `planner.py` — extract `tokenIn`/`tokenOut` as symbol-or-0xADDRESS (checksum/0x validate);
      don't scale a custom input leg in the classifier (defer to web); confirm/echo on malformed address.
      `services/agent/src/sparkpoint_agent/agents/planner.py`.
- [ ] T040 [US4] `dag.py` `_swap_proposed_action` — emit the real pair (address + decimals-deferred) +
      `chainId`; keep the swap OUTSIDE policy (no `propose()`/`policy_gate()`).
      `services/agent/src/sparkpoint_agent/coordinator/dag.py`.
- [ ] T041 [US4] `inlineIntentFor` — forward the pair; fall back to ETH↔USDC for old shape; resolve decimals
      via `resolveErc20`. `apps/web/src/components/screens/chat/live-blocks.tsx`.
- [ ] T042 [US4] `inline-swap-confirm.tsx` — carry `tokenIn`/`tokenOut` (not boolean); signing-gate safety
      badges + address; chainId-vs-wallet reconciliation (switch/refuse); seed amount from `tokenIn.decimals`.
      `apps/web/src/components/screens/chat/inline-swap-confirm.tsx`.
- [ ] T043 [US4] Mock offline `SwapCard` — generic from/to (migrate `actions.review({kind:'swap',
      ethToUsdc})` shape). `apps/web/src/components/screens/chat/cards.tsx`,
      `apps/web/src/app/(app)/chat/page.tsx`.
- [ ] T044 [P] [US4] Living docs: `CHANGELOG.md` + `whats-new.json` ("Swap any token from chat").

**Checkpoint**: chat swap == manual swap in tokens, fee, and safety; back-compatible.

---

## Phase POLISH: Cross-cutting

- [ ] T045 [P] [POLISH] Playwright e2e `swap-custom-token.spec.ts` (paste→resolve→quote→review) +
      `chat-swap-parity.spec.ts` (proposed unlisted token ⇒ ⚠ gate). `apps/web/e2e/pw/`
      (`domcontentloaded` + long hydration budget).
- [ ] T046 [POLISH] Re-run the full honest-state matrix on the develop/alpha environment across 84532 +
      46630; paste evidence into the PR body.
- [ ] T047 [P] [POLISH] Confirm no policy/parity CI drift (the additive wire fields are structural, not
      `Asset`/`TargetRef`); run the T098 parity check.
- [ ] T048 [POLISH] Security self-review vs FR-016..019 + Constitution I/II (non-custody, unverified-by-
      default, decimals-authoritative, no fabricated numbers) before requesting review.

---

## Dependencies & Execution Order

- **Phase 0** first (optional but recommended) — halves later diffs.
- **US1 (P1, MVP)** → **US2 (P2)** → **US3 (P2)** → **US4 (P3)**. Each ships to `develop` independently.
- Within a story: tests before implementation; `metadata`/`tokenList`/`importedTokens` (T006–T008) are
  parallel; `path`/`abis` (T018, T019) parallel; the resolver/exec/page tasks are sequential (shared files).
- US3 T030/T032 gated on the T028 probe. US4 T037 (web schema) lands before the agent (T038–T040) deploys.

## Parallel Opportunities

- T004/T005 (tests) · T006/T007/T008 (new independent modules) · T016/T017 · T018/T019 · living-docs [P]
  tasks. Different-file [P] tasks within a phase can run concurrently; shared-file tasks (`useSwapConfirm`,
  `useExecuteSwapTx`, `page.tsx`) must serialize.

## Notes

- Commit after each task or logical group; branch `007-universal-swap` off `develop`.
- Confirm before any `git push` / PR / merge (repo CLAUDE.md) and before any Coolify/prod action.
- Non-custody + fail-closed honesty are review gates, not afterthoughts (Constitution I/II/III).
