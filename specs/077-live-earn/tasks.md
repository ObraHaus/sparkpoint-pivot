# Tasks — 077 live earn slice

Status legend: [x] done · [~] in progress · [ ] pending · [!] blocked/owner decision.

## 0. Research + spec
- [x] Verify Kamino SOL vs USDC vaults (195 vaults: 23 SOL, 111 USDC) and that a SOL deposit is
      buildable (unsigned v0 tx wraps native SOL in-tx).
- [x] Decode Kamino deposit/withdraw unsigned txs; record program ids, discriminators, fees.
- [x] Verify Morpho Base vault (`Gauntlet USDC Prime`), asset 6 dp / share 18 dp, preview maths.
- [x] Write `research.md`, `plan.md`, `tasks.md`.

## 1. Shared flags + route
- [x] `lib/earn/liveFlags.ts` + tests.
- [x] `/vault/live` shared review route.

## 2. Kamino live slice (priority)
- [x] `lib/earn/kaminoLive.ts` (curated vaults, validation, tx decode/summarize, position parse).
- [x] `POST /api/earn/kamino/prepare` (flag-gated, allowlisted, unsigned only).
- [x] `GET /api/earn/kamino/positions` (read-only read-back).
- [x] `lib/solana/wallet.ts` injected wallet adapter (signs only on explicit call).
- [x] `components/vault/KaminoLiveFlow.tsx` (amount → review → wallet confirm → read-back).
- [x] `/vault` + chat card link into `/vault/live` (dual access).
- [x] Feature flags default off (`EARN_LIVE_KAMINO` / `NEXT_PUBLIC_EARN_LIVE_KAMINO`).

## 3. Morpho live slice (Base)
- [x] `lib/earn/morphoLive.ts` (curated vault, approve+deposit / redeem plan, decimals).
- [x] `components/vault/MorphoLiveFlow.tsx` (live reads, gas estimate, review, user-signed execute).
- [x] Flag default off (`EARN_LIVE_MORPHO` / `NEXT_PUBLIC_EARN_LIVE_MORPHO`).

## 4. Tests + simulation
- [x] Unit tests: flags, Kamino request/summary/positions, Morpho plan, Solana wallet adapter.
- [x] `scripts/earn-sim/kamino-sim.mjs` — read-only `simulateTransaction`, SIMULATED output.
- [x] `scripts/earn-sim/morpho-sim.mjs` — `eth_call` + `eth_estimateGas`, expected unfunded fail.
- [x] `pnpm --filter @sparkpoint/web lint` (clean), `test` (943/943 pass), `build` (succeeds) and
      `tsc --noEmit` (clean once `next build` generates the untracked `next-env.d.ts`).
- [x] Agent `ruff`/`mypy`/`pytest` smoke (no agent code changed).

## 5. Docs
- [x] `CHANGELOG.md` entry.
- [x] `services/agent/content_seed/whats-new.json` entry.
- [x] `docs/demo/072-hackathon-demo.md` honest live-behind-flag note.
- [x] `STATUS.md` updated after Kamino and Morpho milestones.

## 6. Rhea (only if time)
- [ ] Live Rhea deposit/withdraw. Not in this slice; 071 preview + NEP-413 sign-only + link-out
      remain. Needs owner decision on the MPC/relayer path and a funded NEAR test account.

## Blockers / owner decisions
- [!] A funded, owner-approved test wallet is required before any real execution. Until then:
      **simulated only**.
- [!] Confirm whether production should use a keyed Kamino API or the public endpoints (today
      public, keyless).

## 7. Harden milestone (2026-11-09)
- [x] Kamino vault metadata limits (`minDepositAmount`, `minWithdrawAmount`, `depositCap`/remaining,
      `tokenMint`, `sharesMint`, decimals) parsed and enforced in validation + prepare.
- [x] Mint/decimals mismatch refused (`mint_mismatch`); honest min/cap messages.
- [x] SOL Max/submit reserve (fees + ATA rent + 0.005 SOL buffer); `insufficient_balance` refused
      before prepare and again before sign.
- [x] Full unsigned-tx shape validation (program allowlist, instruction-kind allowlist, System
      transfers only to the derived wSOL ATA, amount/vault/mint/owner checks, lookup tables resolved)
      in the BFF **and** re-run in the browser before wallet sign.
- [x] Steakhouse mint labelled as the vault's USDC asset mint (not native/Circle USDC).
- [x] Signature-status tracking after confirm (`confirmed`/`failed`/`pending`, never fake success).
- [x] Withdraw shows real shares + estimated assets; disabled at zero shares; withdraw-all sentinel
      only accepted when the typed amount equals full shares.
- [x] Morpho asset/share decimals validated and `maxDeposit`/`maxRedeem`/`maxWithdraw` enforced.
- [x] Malicious fixtures + boundary/reserve/flags tests; full web suite green.
- [x] Simulations re-run with SIMULATED labels; expected reverts/zero-share redeem are explicitly
      **not** passes for funded execution.
