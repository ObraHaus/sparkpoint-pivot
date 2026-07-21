# Research: Universal Swap (Phase 0)

Decisions and rationale grounding the plan. Sources: direct read of `apps/web/src/lib/swap/*`,
`packages/shared/src/addresses/*`, the chat swap surface, and an adversarial review of the first draft.

## D1 — Extend the existing swap library, don't replace it

**Decision**: Keep the current viem/wagmi, user-signed, QuoterV2/SwapRouter02 architecture and add to it.

**Rationale**: The shipped swap already satisfies the hard invariants (non-custodial, user-signed,
fail-closed, on-chain fee split). A routing service or aggregator SDK/API would add a trust + custody
surface and a runtime dependency for no benefit (Principle VII). The gaps are additive: token resolution,
path encoding, route selection, a fee-recipient field.

## D2 — On-chain metadata is authoritative for both legs

**Decision**: `resolveErc20(chainId, address)` reads `decimals`/`symbol`/`name` on-chain (multicall,
`allowFailure`), requires a non-empty bytecode + a readable `decimals()` (hard gate), retries `symbol`/
`name` as `bytes32` when the string decode fails (MKR-era tokens), sanitizes strings, and clamps decimals.
Wire/agent/cached decimals are **hints only**, never used for scaling.

**Rationale**: A wrong/adversarial `decimals` on the *input* leg mis-scales what the user pays by powers of
ten (a fund-safety hole). Since both legs can now be custom, both must be resolved on-chain (FR-003).
Rejected: trusting `tokenIn/tokenOut.decimals` from the wire — the security review flagged it as a direct
overspend vector.

## D3 — Multi-hop via WETH (and USDC where real)

**Decision**: `route.ts` enumerates per amount: (a) direct single-hop across fee tiers `[500,3000,10000]`,
(b) 2-hop via WETH, (c) 2-hop via USDC — then picks max output, fail-closed to `noRoute` only if all
revert. Native ETH is normalized to WETH **before** pruning so a degenerate `WETH|fee|WETH` leg is never
enumerated. Skip via-WETH when a side is WETH; skip via-USDC when a side is USDC or on a network where USDC
is not a real routing asset (Base Sepolia's Aave test USDC).

**Rationale**: Most arbitrary pairs have no direct pool, so single-hop-only would make "universal"
misleading. Two hops through the deepest common assets covers the vast majority of real routes without a
full graph search. Bounded fan-out keeps RPC cost sane on the CPU-starved box. `QuoterV2.quoteExactInput`
returns **arrays** (per hop) vs the single-fn scalars — a decode footgun to unit-test.

**Tie-break note (recorded omission)**: selection is pure max gross output; on L2 the gas delta between a
direct and a 2-hop route is minor. Ties favor the single-hop/direct route. No gas-priced-in-token ranking
in v1.

## D4 — The 0.20% fee is hop-agnostic and composes with multi-hop

**Decision**: Keep the existing fee mechanism — swap output goes to the router (`ADDRESS_THIS`), then a
single pay-leg (`sweepTokenWithFee` for ERC-20 out, `unwrapWETH9WithFee` for native out) sends output−0.20%
to the user and the fee to the recipient on-chain. For multi-hop, only the swap leg changes
(`exactInput(path)` instead of `exactInputSingle`); the pay-leg is identical because the fee is always
taken on the final token the router holds.

**Correction folded in**: the no-fee **native-out** multi-hop path must use `recipient: ADDRESS_THIS` +
`amountOutMinimum: 0n` then `unwrapWETH9(minOut, user)` — NOT `recipient: user` then unwrap (which would
find nothing). The on-chain `amountMinimum` passed to the pay-leg MUST be the **gross** floor
(`amountOutMinimum(grossOut, slippage)`), never the net (post-fee) value.

## D5 — Fee recipient: add a vault-independent per-chain field

**Decision**: Add optional `swapFeeRecipient?: Address` to the `AddressBook` (a plain field, NOT a policy
`TargetRef`). Resolve the recipient as `swapFeeRecipient ?? vault.feeRecipient()`. Keep the **fee-gate
synchronous**: `feeExpected = !!swapFeeRecipient || !!vault`, and keep the guard `if (feeExpected &&
!feeReady) return undefined` so a still-loading recipient blocks execution rather than degrading to a
fee-free swap. Reject a zero/unconfigured recipient before activating the fee.

**Rationale**: The security review found that redefining the gate around an async recipient opens a window
where a swap builds fee-free before the read resolves (a silent fee bypass, and a displayed-fee ≠
collected-fee divergence). Keeping the *expectation* synchronous and only the *value* async closes it.
Backward-compatible: unset `swapFeeRecipient` on a vault chain falls back to the live vault read → today's
behavior.

## D6 — Robinhood 46630 fee: probe first, honest fallback

**Decision**: Before enabling the fee on 46630, probe the Synthra `SwapRouter02` for `unwrapWETH9WithFee` +
`sweepTokenWithFee` **and** the multi-hop `exactInput`/`quoteExactInput` selectors (`eth_getCode` +
selector presence / a `simulateContract` dry-run). If present → enable the in-swap split. If absent →
**fee-on-input** (route `amountIn × 0.998`, transfer the input-side fee separately) OR keep 46630 fee-free
and show no fee. A partial `sweepToken` split is **mechanically impossible** (it sweeps the whole balance),
so it is explicitly rejected.

**Rationale**: The current code avoids `*WithFee` on no-vault chains "because some V3 forks omit them" — an
unverified assumption we must resolve on-chain, never by displaying a fee we can't collect (FR-012).

## D7 — Safety at the signing gate, not just the picker

**Decision**: The review/confirm surface (both `/swap` and the inline chat card) shows the token address +
verified/unverified badge for any non-recommended token, a "NOT the official {SYMBOL}" note on symbol
collisions (compared by address, after sanitizing), and an "I understand" acknowledgement gate for an
unverified receive-token. Agent-proposed tokens are unverified by default (RAG is untrusted input).

**Rationale**: The confirm card renders `symbol` only today, and `symbol` is attacker-controlled; the last
line of defense must distinguish a fake "USDC" from the real one.

## D8 — Chat parity is mostly free once the resolver is token-generic; the seam is additive & ordered

**Decision**: Change `useSwapConfirm` params from `ethToUsdc: boolean` to explicit `tokenIn/tokenOut`.
Extend `ProposedActionSchema` with optional `tokenIn/tokenOut/chainId` (keep `asset` for back-compat).
**Deploy the web schema first**, tolerant of both old single-asset and new pair shapes; `inlineIntentFor`
falls back to ETH/USDC when the pair is absent.

**Rationale**: `ProposedActionSchema` is `.strict()` and the agent redeploys independently (per memory). If
the agent ships new fields first, the web `.strict()` parse rejects the whole action block. Web-first +
tolerant parse avoids a broken intermediate state.

## D9 — Reconcile the manual "Route via" DEX selector with an auto-router

**Decision**: With `route.ts` auto-selecting the best single/multi-hop path, a manual DEX picker is
incoherent and risks a dishonest route label. Retire the manual `Seg` selector in favor of an honest
auto-route summary (e.g. `TOKEN → WETH → USDC · 0.3% pool`). Keep the venue name honest per chain (Synthra
V3 on 46630).

## D10 — Testing focuses on pure units + the honest-state matrix

**Decision**: Unit-test `path.ts` (byte-exact), `route.ts` (selection/prune/fail-closed), `metadata.ts`
(bytes32, missing-decimals reject, sanitize), and the unchanged `math.ts`. Integration-test the `SwapExec`
shape (`path` vs `fee`) and fee-leg composition with a mocked viem client. Add the first Playwright e2e for
paste-token + chat parity (use `domcontentloaded` + a long hydration budget per the CPU-starved-box memory).

## Open verifications carried into implementation

- Synthra 46630: `*WithFee` + `exactInput`/`quoteExactInput` selector presence (D6). Gates Phase C on 46630.
- Which address is the routing-fee treasury per chain (operator input) — recommend a dedicated
  `swapFeeRecipient`, keep the live vault read as the auditable fallback where a vault exists.
- Base Sepolia: confirm USDC-as-hop is not viable (Aave test token) → skip the USDC hop there.
