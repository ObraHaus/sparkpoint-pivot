# Rhea live execution — research + blocker (077, 2026-11-09)

Status: **BLOCKED** — no safe user-signed NEAR execution path without a relayer/custodian.

## What exists today (unchanged)

- 071 backend: Rhea/Burrow preview via a **1Click intent** (`origin Base/ETH/SOL USDC →
  nep141 NEAR USDC`) with `customRecipientMsg` (`BurrowSupply` / `BurrowRegisterAndSupply`), MCA
  lookup (`multica.near`), one-off MCA fee, live `get_asset` APY, and position reads
  (`get_account_all_positions`).
- 075 web: `signMessage` NEP-413 only. The Phase C card explicitly says “signing only, not
  submitted”; the deposit button stays disabled. This is honest today.
- Withdraw is a link-out to `https://app.rhea.finance/lending`; there is no in-app Rhea withdraw.

## Can we build a real unsigned deposit the user's NEAR wallet signs?

**No, not with the current contracts/rails.**

1. **The 1Click deposit is signed on the origin chain, not on NEAR.** The Rhea SDK's cross-chain
   supply flow is `personal_sign` over `[{"EVM":"<addr>"}]` (an EVM authorization) plus
   `customRecipientMsg`. The 1Click relayer/bridge submits the destination-chain action. A NEAR
   wallet `signMessage` (NEP-413) is an off-chain authentication claim; it is not a transaction and
   nothing broadcasts it. Shipping it as “live execution” would be exactly the fake sign-only the
   hardening brief forbids.
2. **Withdraw needs the MCA key or a Rhea relayer.** `contract.main.burrow.near` withdraw is a NEAR
   transaction whose signer must be the MCA (`multica.near` account, derived from the user's EVM
   wallet). The beta has no MCA full-access key and no Rhea unsigned-tx API that the user's NEAR
   wallet can sign. The existing `signMessage` adapter cannot produce a NEAR transaction signature,
   and even if it could, the MCA key is not the user's connected NEAR wallet.
3. **No NEAR wallet in the beta rail.** The web connects an EVM wallet; the NEAR account is a
   display/claim fallback. A real NEAR-signed path would need a NEAR wallet adapter + funds for gas,
   plus the MCA authorization model above.

## What would unblock it (owner decision required)

- A Rhea/1Click **relayer or intent endpoint** that accepts a user authorization and returns a
  status/receipt we can honestly show, **or**
- Rhea publishing an **unsigned NEAR transaction** (deposit/withdraw) that the user's NEAR wallet
  can sign and a public RPC can submit directly without custodian keys, **or**
- An explicit owner decision to custody/relay MCA keys (not compatible with the current
  non-custody posture).

Until one of those exists, Rhea stays preview + link-out + explicit sign-only. No `EARN_LIVE_RHEA`
flag or live Rhea execution code was added.
