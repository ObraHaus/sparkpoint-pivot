# Plan — 078 Rhea same-chain NEAR direct earn

**Branch:** `feat/078-rhea-near-direct-earn` (worktree `sparkpoint-pivot-078`, based on
`origin/develop`).

## Deliverables

1. **Wallet capability (separate from login).**
   - Extend `apps/web/src/lib/near/adapter.ts` with `sendTransactions(transactions, {expectedAccountId})`
     and `getConnectedAccount()`.
   - The adapter re-reads the wallet's current account immediately before the wallet call and
     refuses a switch. Login/NEP-413 methods never call it.
   - Extend `NearWalletProvider` with the same explicit methods.
   - Split the source guard in `noTransaction.test.ts`: login/preview files must contain no
     transaction call; `adapter.ts`'s only wallet transaction call must sit inside
     `sendTransactions`. Add `transaction.test.ts` covering the refuse-on-switch and no-tx-on-login
     behaviour.

2. **Pure Burrow builder (`apps/web/src/lib/near/burrow.ts`).**
   - Pinned Burrow contract and native USDC token (verified `decimals=6`, `extra_decimals=12`).
   - Allowlists, exact amount parsing/bounds, 6-dp ↔ 18-dp conversion.
   - Supply plan: optional `storage_deposit` (Burrow min `0.1` NEAR; token receiver min `0.00125`
     NEAR only if unregistered) + `ft_transfer_call` with empty supply msg, `1` yocto, `100` Tgas.
   - Withdraw plan: `execute` → `Withdraw` with exact `token_id` / 18-dp `max_amount`, `1` yocto,
     `100` Tgas.
   - Balance / supplied / withdraw-disabled refusals, gas reserve, freshness, wallet-switch guard,
     receipt classification (never fake success).

3. **Read-only preflight + receipt routes.**
   - `POST /api/earn/rhea/live` (read-only): returns the **unsigned** actions + review fields
     (account, amount, balances, storage, block). 404 when `EARN_LIVE_RHEA` is not exactly `true`.
   - `GET /api/earn/rhea/live`: pinned market info, same gate.
   - `GET /api/earn/rhea/receipt`: read-only `tx` lookup; returns confirmed/failed/pending honestly.
   - Extend `apps/web/src/lib/near/rpc.ts` with generic view/account/block/tx reads. No send surface.

4. **Flags (both default off).**
   - Server: `EARN_LIVE_RHEA` gates the API and the `/vault/live` server page (404 when off).
   - Browser: `NEXT_PUBLIC_EARN_LIVE_RHEA` shows entry points from `/vault` and Sparky's Rhea card.
   - No merge/deploy/flag-enable is performed by this branch.

5. **UI.**
   - Self-contained `/vault/live` page (`RheaLiveEarn`) because 077's live route is not on develop.
   - Connect NEAR wallet → choose supply/withdraw → amount (or Max for withdraw) → read-only
     preflight → explicit review screen + acknowledgement → confirm → wallet send → receipt polling.
   - Wallet switch and stale plan refuse before send; errors are plain and actionable.
   - Links from `/vault`'s earn registry row and the chat Rhea earn quote card when the public flag
     is on.

6. **Simulation.**
   - `scripts/earn-sim/rhea-near-sim.mjs`: read-only views + dry-build unsigned supply/withdraw
     actions against `sparkpoint2026.near`.
   - Output is labelled `SIMULATED`, `sent:false`, `signed:false`; expected insufficient-balance /
     no-position results are labelled “NOT a pass”.

7. **Docs.**
   - This spec set; CHANGELOG entry; in-app `whats-new.json`; demo note.
   - Explicit statement that cross-chain MCA/1Click Phase C remains deferred.

## Non-goals

- No cross-chain MCA/1Click deposit/withdraw, no EVM `personal_sign`, no Rhea API key, no relayer.
- No merge, deploy, flag enablement, CI rerun/bypass.
- No signing/approval/transfer/submit/broadcast by the implementation or simulation.
- No other Burrow market or token; no `wrap.near`; no allowance/over-approval pattern.

## Test plan

- Unit: action builders, allowlists, storage checks, reserves, amount bounds, withdraw limits,
  receipt classification, freshness, wallet-switch refusal, flag gating, login path has no tx call,
  adapter refuses a switched account.
- Run: targeted + full web unit tests, web lint, app/test typecheck, `next build`, secret scan of
  the diff.
- Simulation: run `rhea-near-sim.mjs`; record sanitized result (expected failures clearly labelled).

## Acceptance

1. With flags off, the routes 404 / entry points hidden; login still never touches a transaction.
2. With flags on and a connected NEAR wallet, a supply review shows exact amount, storage/gas
   reserve, contract, token and block; confirming sends only the built allowlisted actions.
3. A wallet switch between review and confirm is refused without a signature.
4. A withdraw review refuses when no position / over supplied / withdrawals disabled.
5. Receipt polling reports confirmed only from a final successful receipt; pending/failed otherwise.
6. Full web tests, lint, typecheck and build are green; the simulation is labelled SIMULATED.
