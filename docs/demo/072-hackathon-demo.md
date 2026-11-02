# Hackathon demo — SparkPoint 068 → 072 (about 6 minutes)

A single, honest walkthrough of what is live today: cross-chain swap quotes, three earn paths
(Morpho, Kamino, Rhea) and a read-only multi-chain portfolio. Every prompt below is one the
deterministic parsers actually support and is pinned by the offline golden cases
(`services/agent/evals/golden.yaml`).

> **The one-line story:** SparkPoint shows you the whole picture across chains and prepares every
> move, but **nothing here signs, deposits or withdraws**. You review; your wallet stays yours.

## Status labels used below

| label | meaning |
|---|---|
| **Works now** | Read-only or a dry preview. No funds move, nothing is signed. |
| **Needs funded wallet** | You need a wallet with a balance (and a little gas) to see the *real* numbers. Still no signing in this phase. |
| **Needs Phase C** | Live deposit, account creation, signing or withdrawal — not built yet. The UI says so. |

## Prerequisites

- A browser wallet (MetaMask or similar) on **Base**. Use a **throwaway/test wallet only**.
- No private key, seed phrase or API secret is ever entered into the app, this doc, or a terminal.
  Sign-in is a free SIWE message — it proves the wallet is yours and moves nothing on-chain.
- The beta URL: replace `<BETA_URL>` with your deployment host, e.g.
  `https://<BETA_URL>/chat`. Never paste a bearer token or `.env` value into the demo.
- A funded wallet is **optional** for this demo. Most steps are previews and reads; a funded wallet
  only makes the balances/positions look less empty.
- Environment is whatever the deployment already uses. Do **not** change Defender, CI, model or
  billing config for the demo.

## Before the clock starts (30 seconds)

1. Open `<BETA_URL>/connect`.
2. Connect the test wallet.
3. Sign the SIWE message. The screen says **“You're in.”** — that is the session, not a transaction.

---

## The run of show

### 1. Sign in with SIWE — **Works now**

- **Do:** connect + sign the free message at `/connect`.
- **Expected on screen:** “You're in.”, then the app shell. No network transaction, no gas.
- **Talking point:** non-custodial by construction — the session is a signed message, the wallet
  keeps the key, and SparkPoint never holds funds.

### 2. Cross-chain swap quote (068) — **Works now** · actual swap **Needs Phase C**

- **Type exactly:** `swap 50 USDC to SOL`
- **Expected on screen:** a `crosschain_quote` **preview** card: origin “50 USDC on Base”, destination
  Solana, an estimated output, the keyless routing fee note, and a plain “preview only” line.
  No confirm/send button exists in this phase.
- **Talking point:** the quote is a dry read of 1Click's route. The card never carries calldata or a
  signature; sending would be your own wallet transfer in Phase C.
- **Fallback:** if 1Click is slow or has no liquidity, the same card returns `unavailable` with a
  reason and “nothing was signed”. Say that out loud — it is the honest degraded state. Try a
  smaller amount such as `swap 10 USDC to SOL`.

### 3. Morpho vault list + deposit preview (069) — **Works now** · deposit **Needs Phase C**

- **Type exactly:** `Show Morpho vaults on Base`
- **Expected on screen:** the `earn_vaults` card with Morpho/Base badges, TVL, net APY labelled as
  Morpho's own figure, the three rails (Direct / 1Click Earn / Intents Connect), and a snapshot-age
  line. Each row has **Preview** and a Morpho source link.
- **Then type exactly:** `Deposit 100 USDC into Morpho Gauntlet USDC Prime`
- **Expected on screen:** an `earn_quote` **preview**: amount in, estimated 1Click receipt amount,
  ETA, the 0.25% keyless fee, and the honest note that the receipt is a **NEAR-issued wrapper, not
  the native Morpho share**. No sign button.
- **Talking point:** data provenance — APY comes from the vault snapshot, the preview is a dry
  quote, and the card tells you exactly what the receipt is.
- **Fallback:** “no liquidity” returns an `unavailable` card with a reason; try a smaller amount.

### 4. Kamino SOL vault + Solana recipient (070) — **Works now** · deposit **Needs Phase C**

- **Type exactly:** `Show Kamino vaults`
- **Expected on screen:** the Kamino SOL list: `SOL Balanced`, Kamino + Solana badges, TVL, net APY,
  and the **native vault shares** receipt (the receipt *is* the kVault share, not a wrapper).
- **Then type exactly:** `Deposit 100 USDC into Kamino SOL vault`
- **Expected on screen:** a Kamino preview with a **pasted Solana recipient** step. Pasting an EVM
  `0x…` address is rejected with “base58 Solana address”; a valid base58 address is accepted. The
  deposit path is visibly disabled with “Live deposits coming soon (phase C)”.
- **Talking point:** Solana is not the session chain. SparkPoint never reuses your EVM address as a
  Solana address, and the client never supplies an arbitrary Solana address to read positions.
- **Fallback:** no-liquidity previews say “try a smaller amount”; the recipient step disappears.

### 5. Rhea vault list from a vague NEAR-yield ask (071) — **Works now** · deposit **Needs Phase C**

- **Type exactly:** `earn yield on NEAR`
- **Expected on screen:** routing lands on **Rhea Lending (USDC only for now)** — the Rhea list, not
  a “NEAR isn't supported” dead end. You see the Rhea/NEAR badges, the supply APY **14.05%**, the
  APY **source link** to `app.rhea.finance`, and a Preview action.
- **Talking point:** vague intent still routes honestly: NEAR *yield* → Rhea lending; native NEAR
  token staking is explicitly not supported.
- **Fallback:** if the Rhea read is stale/unavailable, the list says so; the source link still shows
  where the rate comes from.

### 6. Rhea first-deposit preview with the 0.30 USDC fee (071) — **Works now** · deposit **Needs Phase C**

- **Type exactly:** `Deposit 100 USDC into Rhea`
- **Expected on screen:** an `earn_quote` preview with:
  - estimated supplied amount **99.9808 USDC**;
  - **One-time Rhea account setup fee: 0.30 USDC (first deposit only)**;
  - **Net supplied ≈ 99.6808 USDC**;
  - the supply APY line and its exact contract source
    (`contract.main.burrow.near get_asset.supply_apr`);
  - the Rhea account manager recipient (`multica.near`) and the message your wallet will sign in
    **Phase C** to create the account — shown as display-only, not signable.
- **Talking point:** the fee is taken once, on the first deposit only; the APY is a contract read
  with its provenance, not a marketing number.
- **Fallback:** if the APY contract read fails, the card says the APY is unavailable rather than
  inventing one.

### 7. Rhea positions (071) — **Works now** · real positions **Need a funded wallet + Phase C**

- **Type exactly:** `Show my Rhea positions`
- **Expected on screen:** the read-only `earn_positions` card. With no Rhea account yet it says so
  plainly and offers the explainer; with a funded Rhea account it lists symbol, supplied amount and
  the contract's supply APY, plus **Withdraw on Rhea** (an external link).
- **Talking point:** this is a view of your Multichain Account on NEAR. Nothing is signed, and
  withdrawals happen on Rhea with the same wallet.
- **Fallback:** an RPC failure renders `unavailable` with the reason, never an error card.

### 8. Multi-chain portfolio (072) — **Works now** · populated by **a funded wallet / Phase C**

- **Type exactly:** `show my portfolio`
- **Expected on screen:** the `portfolio_overview` card:
  - a priced total with per-chain and per-protocol breakdowns;
  - **Wallet balances** with chain badges and a per-chain status (an unconfigured Ethereum RPC says
    “not configured” instead of showing zero);
  - **Earn positions** grouped Morpho / Kamino / Rhea, with protocol + chain badges, APY and value;
  - **Cross-chain swaps** with route, amounts, status pill, relative time and a shortened deposit
    address with copy;
  - each section's own degraded/empty state, the sources/as-of line, and the footer
    **“Read-only — nothing here moves funds.”**
- **Talking point:** one dead source or a missing Solana link degrades only that section; totals sum
  only the sections that were actually readable, so no number is invented.
- **Fallback:** a degraded run is a feature — show the Kamino **not_linked** explainer and the empty
  swaps copy. The Portfolio page's **Across chains** panel renders the same body.

### 9. Swap history focus (072) — **Works now**

- **Type exactly:** `my swap history`
- **Expected on screen:** the same card with the **swaps** focus and the title **“Your swap
  history”**: recent routes (e.g. “Base USDC -> Solana USDC”), status pill, relative time, and the
  shortened deposit address with copy.
- **Talking point:** history is owner-scoped and read-only. With no swaps it says
  “You don't have any cross-chain swaps yet.” instead of an empty table.
- **Fallback:** if the database is not configured, the swaps section says exactly that.

---

## Fallbacks if a live source is slow or unavailable

- **Morpho / Kamino / Rhea / swap source down:** the affected section shows `unavailable` with a
  human reason. Keep going — the other sections still render.
- **Kamino with no linked Solana address:** `not_linked` with the Phase C explainer. This is the
  normal state before a Phase C deposit, not an error.
- **No liquidity / minimum too high:** the preview card says so; **“try a smaller amount”**.
- **Swap history DB not configured:** the swaps section says the database is not configured.
- **Totals look lower than expected:** totals only sum readable sections. That is deliberate.

## Timing table

| # | Step | Prompt | Time | Status |
|---|---|---|---|---|
| 0 | Sign in (SIWE) | — | 0:30 | Works now |
| 1 | Cross-chain quote | `swap 50 USDC to SOL` | 0:40 | Works now · Phase C to send |
| 2 | Morpho list | `Show Morpho vaults on Base` | 0:40 | Works now |
| 3 | Morpho preview | `Deposit 100 USDC into Morpho Gauntlet USDC Prime` | 0:40 | Works now · Phase C to deposit |
| 4 | Kamino list | `Show Kamino vaults` | 0:30 | Works now |
| 5 | Kamino preview + recipient | `Deposit 100 USDC into Kamino SOL vault` | 0:50 | Works now · Phase C to deposit |
| 6 | Vague NEAR-yield routing | `earn yield on NEAR` | 0:30 | Works now |
| 7 | Rhea first-deposit preview | `Deposit 100 USDC into Rhea` | 0:45 | Works now · Phase C to deposit |
| 8 | Rhea positions | `Show my Rhea positions` | 0:30 | Works now · funded + Phase C for real positions |
| 9 | Portfolio overview | `show my portfolio` | 0:50 | Works now |
| 10 | Swap history | `my swap history` | 0:25 | Works now |
| — | Q&A / close | — | 0:30 | — |

Total ≈ 6–7 minutes with no failures; ~5 minutes if you skip the two long previews.

## What's next (Phase C)

- Live 1Click Earn / Rhea deposits, including the Rhea account-creation signature.
- Kamino deposits to a pasted Solana recipient, plus the copy-address deposit flow for SOL origins.
- In-app withdraws (today Rhea withdraws link out to `app.rhea.finance`).
- Wallet signing for every move — still user-signed, still non-custodial, still never SparkPoint
  holding the funds.

Until then every card is a dry preview or a read, and says so.

## Prompt verification (why these exact strings)

| Prompt | Parser / golden case |
|---|---|
| `swap 50 USDC to SOL` | `crosschain-74-usdc-to-sol` → `crosschain_preview` |
| `Show Morpho vaults on Base` | `earn-83-list-morpho-vaults` → `earn_list` |
| `Deposit 100 USDC into Morpho Gauntlet USDC Prime` | `earn-85-deposit-named-vault` → `earn_preview` |
| `Show Kamino vaults` | `earn-87-list-kamino-vaults` → `earn_list` |
| `Deposit 100 USDC into Kamino SOL vault` | `earn-88-deposit-kamino-sol-vault` → `earn_preview` |
| `earn yield on NEAR` | `near-29-earn-yield` → `earn_list` (Rhea) |
| `Deposit 100 USDC into Rhea` | `earn-90-deposit-rhea-preview` → `earn_preview` |
| `Show my Rhea positions` | `earn-91-rhea-positions-empty` / `portfolio-110-rhea-positions-unchanged` |
| `show my portfolio` | `portfolio-100-show` → `portfolio_overview` (all) |
| `my swap history` | `portfolio-104-swap-history` → `portfolio_overview` (swaps) |

Related spec: [`specs/072-multichain-portfolio/quickstart.md`](../../specs/072-multichain-portfolio/quickstart.md).
