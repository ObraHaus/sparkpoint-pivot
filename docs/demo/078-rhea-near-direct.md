# Demo — 078 Rhea same-chain NEAR supply/withdraw

**Status:** implemented behind flags, **not enabled** in any deployment by this branch.
**Flags:** `EARN_LIVE_RHEA` (server) and `NEXT_PUBLIC_EARN_LIVE_RHEA` (browser), both default off.
**Scope:** same-chain NEAR → Burrow (Rhea) USDC supply **and** withdraw.

## What to say (and not say)

Say: “With a NEAR wallet, you can now supply native USDC to Rhea/Burrow on NEAR and withdraw it
yourself. You review the exact contract, amount, storage deposit, gas reserve and block, then sign in
your own wallet. We poll the chain and only call it confirmed when it is final.”

Do **not** say: “cross-chain Rhea deposits are live.” They are not. The original 071 **cross-chain
MCA/1Click Phase C** path (EVM `personal_sign`, 1Click quote/deposit address,
`BurrowSupply`/`BurrowRegisterAndSupply`) remains **deferred**. 078 is a separate same-chain rail.

## Demo flow

1. Set both flags in a local/preview environment only after funded testing. (Not done here.)
2. `/vault` → the Rhea row shows **Live supply / withdraw** when the browser flag is on.
3. Connect Meteor (or the wallet picker). The page names the connected NEAR account.
4. Choose **Supply** or **Withdraw**, enter an amount (or Max for withdraw), click **Review**.
5. The preflight is read-only and shows: signing account, Burrow contract, USDC token, wallet USDC
   and NEAR balances, required gas/storage, and the pinned block. Expected refusals are honest:
   insufficient USDC, insufficient NEAR for gas/storage, no position, or withdrawals disabled.
6. Tick the acknowledgement, then **Confirm in NEAR wallet**. A wallet switch or a stale (>60 s)
   review refuses without signing.
7. The receipt poll shows pending → confirmed/failed. Success is never assumed.

## Safety points for the demo

- SparkPoint never holds funds; no access key is added; the login path never asks for a transaction.
- Only allowlisted calls are built: Burrow `storage_deposit` (when needed), USDC `storage_deposit`
  (only if the receiver is unregistered), USDC `ft_transfer_call` with an empty supply msg, and
  Burrow `execute` → `Withdraw`. Attached deposits are exact (storage minima or 1 yocto).
- No approval/allowance exists in this flow.

## Funded gaps

`sparkpoint2026.near` has 0 USDC, no Burrow storage registration and no position. The read-only
simulation (`scripts/earn-sim/rhea-near-sim.mjs`) proves the views and the dry-build only; expected
insufficient-balance/no-position results are **not** funded passes. A funded NEAR account is needed
for a real supply/withdraw demo and to validate the wallet batch UI.
