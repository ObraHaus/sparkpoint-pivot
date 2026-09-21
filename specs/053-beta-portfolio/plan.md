# Plan 053 — Beta portfolio: wallet + wrappers, for the user and the AI

## Constitution check

- **N1:** no new asset path — reads only; the wrapper's ERC-4626 is untouched.
- **N2:** exit untouched; the portfolio is advisory and the web reads custody directly over RPC.
- **III:** no fabricated figures; USDG at **$1 par is labelled par**; unknown ⇒ "—"; the agent read
  stays `stale:true`-markable.
- **IV.5:** a wrapper position is trusted only from the curated board record; a manually added
  token is display-only (never a policy target).
- **V (v4.2.0):** the active build is 4663 — this makes the portfolio describe it honestly.
- **VII:** reuse existing endpoints/hooks; no new service, no contract change. ✅

## Phases (three PRs)

### Phase A — web read layer + UI (PR 1)

| File | Change |
|---|---|
| `lib/portfolio/derive.ts` | Stable at par; wrapper inputs carry their tier; positions include the idle stable row even before any deposit; ETH kept separate. |
| `lib/portfolio/useHeldWrappers.ts` **(new)** | Board-driven held-wrapper reads: `useCuratedBoard()` → batched `balanceOf` → `convertToAssets` for holders. Returns `WrapperPositionInput[]` + settled flag. |
| `lib/portfolio/knownTokens.ts` **(new)** | Per-chain known-token list (4663: USDG, WETH, wrapper share tokens; others unchanged). Pure, unit-tested. |
| `lib/portfolio/useWalletTokens.ts` | Merge explorer enumeration (where mapped) with the known list (direct RPC); support user-added tokens (validated, persisted per chain+wallet). |
| `app/(app)/portfolio/page.tsx` | Compose the new read layer; `live` = connected && settled (launch vault no longer the gate); net worth = par stable + wrapper + launch; allocation by tier incl. cash; idle row + CTA; honest history empty state; drop the "AI vault isn't in the beta" copy. |
| `components/portfolio/WalletTokensCard.tsx` | Known/added token rows; "Add token by address" with validation + honest errors; remove the "discovery isn't available" dead end where the known list applies. |
| Tests | `derive`, `knownTokens`, held-wrapper hook (pure parts), manual-add validation. |

### Phase B — agent `/portfolio` on 4663 (PR 2)

| File | Change |
|---|---|
| `api/portfolio.py` | On 4663: positions = whitelisted wrapper positions (agent DB) + wallet tokens (known list, RPC), stable at par; per-position ids `wrapper:<addr>`; unreadable ⇒ nulls + `stale:true`. |
| `chain/` | Read helper for arbitrary ERC-4626 positions (reuse `VaultReader` primitives); no key, no signing. |
| Tests | Agent tests: 4663 response shape, par valuation, stale degradation, no invented numbers. |

### Phase C — wrapper flow indexer (PR 3)

| File | Change |
|---|---|
| `data/log_source.py` | Index Deposit/Withdraw for whitelisted wrapper addresses on 4663 (idempotent on `(network_id, tx_hash, log_index)`). |
| `db/vault_flows.py` | Flows keyed per position (`wrapper:<addr>`); replay per position for cost basis / realized / unrealized / series. |
| `api/portfolio.py` | Per-position PnL + value history for wrapper positions; honest nulls until the first indexed flow. |
| Tests | Indexer idempotency + replay over wrapper flows; empty-history honesty. |

## Verification

- `pnpm --filter @sparkpoint/web test`, `tsc --noEmit`, `typecheck:test`, `eslint`.
- Agent: `pytest services/agent` (+ the boundary/parity CI jobs).
- Live on beta: a USDG-only wallet shows a real net worth + idle CTA; a wrapper holder shows the
  position; chat answers "what's in my wallet / portfolio" from the real holdings; after a deposit
  the chart/PnL render (indexed).

## Rollback

Revert the phase PRs. No contract, no migration in Phase A; Phases B/C are additive reads/indexing
(a revert leaves the beta portfolio as today's degraded state).
