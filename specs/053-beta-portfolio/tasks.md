# Tasks — 053 Beta portfolio

## Phase A — web (PR 1)

- [x] **T901** `derive.ts`: stable-at-par USD total, idle row before deposit, ETH separate,
      per-vault tier carried on positions.
- [x] **T902** `useHeldWrappers` hook: curated board → batched `balanceOf` → `convertToAssets`;
      settled flag; scales with the fleet.
- [x] **T903** `knownTokens` per-chain list (USDG/WETH/wrapper shares on 4663) + RPC reads.
- [x] **T904** `useWalletTokens`: merge explorer + known + user-added; manual add validates
      (`symbol/decimals/balanceOf`), persists per chain+wallet, removable.
- [x] **T905** Portfolio page: compose read layer; redefine `live`; net worth par; allocation by
      tier incl. cash; idle row + "Put it to work"; honest history empty state; remove the
      "AI vault isn't in the beta" copy.
- [x] **T906** `WalletTokensCard`: known/added rows + add-token form with honest errors.
- [x] **T907** Tests (derive, knownTokens, add validation, held-wrapper pure parts) + full web
      suite/typecheck/lint + both changelogs.

## Phase B — agent 4663 portfolio (PR 2)

- [x] **T908** 4663 branch in `GET /portfolio`: whitelisted wrapper positions + known wallet
      tokens, stable at par, per-position ids; `stale:true` degradation with nulls.
- [x] **T909** Agent tests (shape, par, stale, no invented numbers) + suite green + changelogs.

## Phase C — wrapper flow index (PR 3)

- [ ] **T910** Index wrapper Deposit/Withdraw on 4663 (idempotent, per-position keys).
- [ ] **T911** Per-position replay (basis/PnL/series) + `/portfolio` exposure; honest empty state.
- [ ] **T912** Tests (idempotency, replay, empty history) + suite green + changelogs.

## Ops

- [ ] **T913** Operator: promote + deploy each phase; verify on beta (USDG-only wallet, wrapper
      holder, chat portfolio answer, post-deposit chart).
