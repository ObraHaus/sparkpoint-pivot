# Hackathon demo — SparkPoint multi-chain (current, 081)

A single, honest walkthrough of what the beta does today: **dual access** (manual pages and Sparky
chat), cross-chain swap quotes, three earn protocols across four rails (Morpho, Kamino, Rhea
same-chain, Rhea cross-chain review) and a read-only multi-chain portfolio. Every chat prompt below
is one the deterministic parsers actually support and is pinned by the offline golden cases
(`services/agent/evals/golden.yaml`).

> **Beta:** <https://beta.sparkpoint.io> — `/connect` to sign in, `/chat` for Sparky, `/swap`,
> `/vault` and `/portfolio` for the manual surfaces.

> **The one-line story:** SparkPoint shows you the whole picture across chains and prepares every
> move. By default nothing here signs, deposits or withdraws. With the **live-earn flags ON**, the
> deposit/withdraw review is real — Kamino on Solana, Morpho on Base and Rhea on NEAR build an
> **unsigned** transaction you review and sign in your own wallet. SparkPoint never signs, submits
> or holds funds, and **execution remains simulated until an owner-approved funded test**.

> **Freeze v9 — dual access.** The same multi-chain story is on the manual pages as well as in chat:
> `/swap` is the user-signed, same-network EVM swap on the wallet's supported chain (Base or
> Robinhood Chain) and links cross-chain routes to Sparky, while `/vault` shows the same Morpho
> (Base/Ethereum), Kamino (Solana) and Rhea (NEAR) earn registry Sparky reads. `/portfolio` keeps the
> read-only **Across chains** panel. Nothing on either surface gains custody; Sparky and the pages
> can never disagree about a chain, protocol or rail.

## Dual access at a glance

| Capability | Manual page | Sparky chat | What is real today |
|---|---|---|---|
| Same-network EVM swap | `/swap` | — | Works now · user-signed on Base or Robinhood Chain |
| Cross-chain swap | links to Sparky | `swap 50 USDC to SOL` | Works now · 1Click quote/preview; send from your own wallet where configured |
| Earn registry | `/vault` | `Show Morpho vaults on Base`, `Show Kamino vaults`, `earn yield on NEAR` | Works now · read + dry preview |
| Live Kamino / Morpho | `/vault` → `/vault/live` | earn card → same review | Built · **flag off by default** · unsigned tx, wallet signs |
| Live Rhea same-chain (078) | `/vault` → `/vault/live` | Rhea card → same review | Built · **flag off by default** · unsigned NEAR tx, wallet signs |
| Rhea cross-chain (079) | `/vault` → `/vault/rhea-xchain` | Rhea card → same review | Review only · live commit **flag off by default** · guided withdraw |
| Portfolio | `/portfolio` → Across chains | `show my portfolio` | Works now · read-only across Base, Solana, NEAR |

## Status labels used below

| label | meaning |
|---|---|
| **Works now** | Read-only or a dry preview. No funds move, nothing is signed. |
| **Needs funded wallet** | You need a wallet with a balance (and a little gas) to see the *real* numbers. Still no signing in this phase. |
| **Built, flag off** | The live review exists but is off by default. With the flag on it builds an **unsigned** transaction; you sign in your own wallet. |
| **Preview only** | A dry quote or a guided review. No live commit is enabled in this build. |
| **Live behind flag** | A real unsigned transaction + review + wallet-sign flow exists, but it is off by default. Until an owner-approved funded test, results are **SIMULATED**. |

## Prerequisites

- The beta URL: <https://beta.sparkpoint.io>. Use `/connect`, `/chat`, `/swap`, `/vault` and
  `/portfolio`. Never paste a bearer token or `.env` value into the demo.
- A browser wallet (MetaMask or similar) on **Base** or **Robinhood Chain** (the freeze beta). Use a
  **throwaway/test wallet only**.
- No private key, seed phrase or API secret is ever entered into the app, this doc, or a terminal.
  Sign-in is a free SIWE message — it proves the wallet is yours and moves nothing on-chain.
- A funded wallet is **optional** for this demo. Most steps are previews and reads; a funded wallet
  only makes the balances/positions look less empty.
- Environment is whatever the deployment already uses. Do **not** change Defender, CI, model,
  billing or live-earn flags for the demo.

## Before the clock starts (30 seconds)

1. Open <https://beta.sparkpoint.io/connect>.
2. Connect the test wallet.
3. Sign the SIWE message. The screen says **“You're in.”** — that is the session, not a transaction.

---

## The run of show

### 1. Sign in with SIWE — **Works now**

- **Do:** connect + sign the free message at `/connect`.
- **Expected on screen:** “You're in.”, then the app shell. No network transaction, no gas.
- **Talking point:** non-custodial by construction — the session is a signed message, the wallet
  keeps the key, and SparkPoint never holds funds.

### 2. Cross-chain swap quote (068) — **Works now** · actual send depends on the rail

- **Type exactly:** `swap 50 USDC to SOL`
- **Expected on screen:** a `crosschain_quote` **preview** card: origin “50 USDC on Base”, destination
  Solana, an estimated output, the keyless routing fee note, and a plain “preview only” line.
- **Talking point:** the quote is a dry read of 1Click's route. The card never carries a signature;
  sending would be your own wallet transfer. SparkPoint never signs or submits.
- **Fallback:** if 1Click is slow or has no liquidity, the same card returns `unavailable` with a
  reason and “nothing was signed”. Say that out loud — it is the honest degraded state. Try a
  smaller amount such as `swap 10 USDC to SOL`.

### 3. Morpho vault list + deposit preview (069) — **Works now** · live deposit **Built, flag off**

- **Type exactly:** `Show Morpho vaults on Base`
- **Expected on screen:** the `earn_vaults` card with Morpho/Base badges, TVL, net APY labelled as
  Morpho's own figure, the three rails (Direct / 1Click Earn / Intents Connect), and a snapshot-age
  line. Each row has **Preview** and a Morpho source link.
- **Then type exactly:** `Deposit 100 USDC into Morpho Gauntlet USDC Prime`
- **Expected on screen:** an `earn_quote` **preview**: amount in, estimated 1Click receipt amount,
  ETA, the 0.25% keyless fee, and the honest note that the receipt is a **NEAR-issued wrapper, not
  the native Morpho share**. No sign button in the preview.
- **Talking point:** data provenance — APY comes from the vault snapshot, the preview is a dry
  quote, and the card tells you exactly what the receipt is.
- **Fallback:** “no liquidity” returns an `unavailable` card with a reason; try a smaller amount.

### 4. Kamino SOL vault + Solana recipient (070) — **Works now** · live direct deposit **Live behind flag**

- **Type exactly:** `Show Kamino vaults`
- **Expected on screen:** the Kamino SOL list: `SOL Balanced`, Kamino + Solana badges, TVL, net APY,
  and the **native vault shares** receipt (the receipt *is* the kVault share, not a wrapper).
- **Then type exactly:** `Deposit 100 USDC into Kamino SOL vault`
- **Expected on screen:** a Kamino preview with a **pasted Solana recipient** step. Pasting an EVM
  `0x…` address is rejected with “base58 Solana address”; a valid base58 address is accepted. With
  the live flag off, the deposit path is visibly disabled with “Live deposits coming soon (phase C)”.
- **Talking point:** Solana is not the session chain. SparkPoint never reuses your EVM address as a
  Solana address, and the client never supplies an arbitrary Solana address to read positions.
- **Fallback:** no-liquidity previews say “try a smaller amount”; the recipient step disappears.
- **077 live direct rail (flag on):** with `NEXT_PUBLIC_EARN_LIVE_KAMINO=true`, the same `/vault`
  row and the earn card also offer **Live deposit / Live withdraw**, both opening `/vault/live`.
  A connected Solana wallet (Phantom/Solflare) receives an unsigned Kamino transaction; the review
  shows the exact amount, vault, share mint, program ids, network fee and ATA rent, then the wallet
  signs. SOL is supported (native SOL is wrapped in the same transaction). With the flag off this
  is exactly the 070 preview above.

### 5. Rhea vault list from a vague NEAR-yield ask (071) — **Works now** · deposit **Preview only**

- **Type exactly:** `earn yield on NEAR`
- **Expected on screen:** routing lands on **Rhea Lending (USDC only for now)** — the Rhea list, not
  a “NEAR isn't supported” dead end. You see the Rhea/NEAR badges, the supply APY **14.05%**, the
  APY **source link** to `app.rhea.finance`, and a Preview action.
- **Talking point:** vague intent still routes honestly: NEAR *yield* → Rhea lending; native NEAR
  token staking is explicitly not supported.
- **Fallback:** if the Rhea read is stale/unavailable, the list says so; the source link still shows
  where the rate comes from.

### 6. Rhea first-deposit preview with the 0.30 USDC fee (071) — **Works now** · deposit **Preview only**

- **Type exactly:** `Deposit 100 USDC into Rhea`
- **Expected on screen:** an `earn_quote` preview with:
  - estimated supplied amount **99.9808 USDC**;
  - **One-time Rhea account setup fee: 0.30 USDC (first deposit only)**;
  - **Net supplied ≈ 99.6808 USDC**;
  - the supply APY line and its exact contract source
    (`contract.main.burrow.near get_asset.supply_apr`);
  - the Rhea account manager recipient (`multica.near`) and the message your wallet will sign in a
    live flow to create the account — shown as display-only in the preview.
- **Talking point:** the fee is taken once, on the first deposit only; the APY is a contract read
  with its provenance, not a marketing number.
- **Fallback:** if the APY contract read fails, the card says the APY is unavailable rather than
  inventing one.

### 7. Rhea positions (071) — **Works now** · real positions **Need a funded wallet + live rail**

- **Type exactly:** `Show my Rhea positions`
- **Expected on screen:** the read-only `earn_positions` card. With no Rhea account yet it says so
  plainly and offers the explainer; with a funded Rhea account it lists symbol, supplied amount and
  the contract's supply APY, plus **Withdraw on Rhea** (an external link).
- **Talking point:** this is a view of your Multichain Account on NEAR. Nothing is signed, and
  withdrawals happen on Rhea with the same wallet.
- **Fallback:** an RPC failure renders `unavailable` with the reason, never an error card.

### 8. Multi-chain portfolio (072) — **Works now** · populated by **a funded wallet / live rails**

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

### 10. Live earn review (077) — **Live behind flag · simulated until funded test**

- **Enable (owner only, never in a demo):** build with `NEXT_PUBLIC_EARN_LIVE_KAMINO=true` /
  `NEXT_PUBLIC_EARN_LIVE_MORPHO=true` (and `EARN_LIVE_KAMINO` / `EARN_LIVE_MORPHO` for the server
  build proxy). Off by default.
- **Do:** open `/vault`, find the curated **Kamino SOL Balanced** or **Morpho Gauntlet USDC Prime**
  row, and click **Live deposit** (or **Live withdraw**).
- **Expected on screen:** the shared `/vault/live` review. Kamino: exact SOL/USDC amount, vault,
  share mint, kVault program, network fee and ATA rent, then “Confirm in wallet” (Phantom shows its
  own confirmation). Morpho: live balances/preview, an approve leg only when needed, a gas estimate,
  then approve+deposit or redeem in the wallet.
- **Talking point:** the transaction is **unsigned** until your wallet signs it. SparkPoint never
  signs, approves, submits or holds funds. The review is not a quote and not a receipt.
- **Honesty:** no funded execution has been run. The simulation scripts print **SIMULATED**;
  the Kamino deposit simulates successfully and the unfunded Base probe's deposit fails honestly.
- **Fallback:** with the flags off, the page says live earn is off and the existing 069/070 previews
  are unchanged.

### 11. Rhea same-chain supply/withdraw (078) — **Built, flag off**

- **Flags:** `EARN_LIVE_RHEA` (server) and `NEXT_PUBLIC_EARN_LIVE_RHEA` (browser), both default off.
- **Scope:** same-chain **NEAR → Burrow (Rhea) USDC** supply and withdraw, signed by the user's own
  NEAR wallet. This is **not** the cross-chain Rhea/1Click rail.
- **Expected when enabled:** `/vault` → Rhea row → **Live supply / withdraw** → `/vault/live`. The
  read-only preflight shows the signing account, Burrow contract, USDC token, wallet balances,
  storage/gas reserve and pinned block; you tick an acknowledgement and confirm in the NEAR wallet.
  A wallet switch or a stale review refuses without signing. Receipts are polled and reported
  confirmed / failed / pending honestly.
- **Talking point:** no access key is added, no allowance exists, and only allowlisted calls are
  built. With the flags off, the 071 preview and Rhea link-out are unchanged.

### 12. Rhea cross-chain review (079) — **Preview only · live commit flag off**

- **Scope:** EVM USDC (Base/Ethereum) → Rhea/Burrow on NEAR through **NEAR Intents 1Click + Rhea
  Multichain Account (MCA)**. This is **not** 078's same-chain NEAR flow.
- **Flags:** `EARN_LIVE_RHEA_XCHAIN` / `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN`, default off. A live
  commit is refused unless the server flag is on **and** the 1Click credential is present.
- **Expected when the review is enabled:** `/vault` → Rhea row → `/vault/rhea-xchain`. The dry
  review shows origin chain/asset/amount, refund address, the MCA recipient message, the one-time
  MCA fee, routing fee, net supplied and supply APY. A live commit (when allowed) returns a live
  1Click quote, the deposit address and an **unsigned** origin ERC-20 `transfer` plan; a first
  deposit asks for one off-chain `personal_sign`, not a transaction.
- **Withdraw posture:** a **guided review** — documented Rhea SDK paths (`relayer`,
  `nearMcaWithdrawTx`) first, the Rhea app link-out last. It states `nep413IsTransaction=false`,
  `custodian=null`, `signedBySparkPoint=false`. A link-out is **not** a SparkPoint-signed
  transaction.
- **Talking point:** no funded cross-chain execution has been run, and SparkPoint does not invent a
  relayer or custodian it does not have.

---

## Withdraw postures (say this precisely)

| Rail | How withdrawal works today | Custody |
|---|---|---|
| 077 Kamino (Solana) / Morpho (Base) | In-wallet, unsigned redeem/withdraw review → your wallet signs | None |
| 078 Rhea same-chain (NEAR) | In-wallet, unsigned Burrow `execute → Withdraw` review → your NEAR wallet signs | None |
| 079 Rhea cross-chain | **Guided review only**: documented Rhea SDK paths first, Rhea app link-out last; no in-app signed withdraw | None |
| 071 Rhea preview | External link to `app.rhea.finance` | None |

Nothing above gives SparkPoint the ability to move, freeze or withhold funds.

## Fallbacks if a live source is slow or unavailable

- **Morpho / Kamino / Rhea / swap source down:** the affected section shows `unavailable` with a
  human reason. Keep going — the other sections still render.
- **Kamino with no linked Solana address:** `not_linked` with the live-rail explainer. This is the
  normal state before a live deposit, not an error.
- **No liquidity / minimum too high:** the preview card says so; **“try a smaller amount”**.
- **Swap history DB not configured:** the swaps section says the database is not configured.
- **Totals look lower than expected:** totals only sum readable sections. That is deliberate.
- **Live earn flags off:** the live entry points are absent; the previews above still work.

## Timing table

| # | Step | Prompt | Time | Status |
|---|---|---|---|---|
| 0 | Sign in (SIWE) | — | 0:30 | Works now |
| 1 | Cross-chain quote | `swap 50 USDC to SOL` | 0:40 | Works now · send depends on rail |
| 2 | Morpho list | `Show Morpho vaults on Base` | 0:40 | Works now |
| 3 | Morpho preview | `Deposit 100 USDC into Morpho Gauntlet USDC Prime` | 0:40 | Works now · live flag off |
| 4 | Kamino list | `Show Kamino vaults` | 0:30 | Works now |
| 5 | Kamino preview + recipient | `Deposit 100 USDC into Kamino SOL vault` | 0:50 | Works now · live behind flag |
| 6 | Vague NEAR-yield routing | `earn yield on NEAR` | 0:30 | Works now |
| 7 | Rhea first-deposit preview | `Deposit 100 USDC into Rhea` | 0:45 | Works now · preview only |
| 8 | Rhea positions | `Show my Rhea positions` | 0:30 | Works now · funded for real positions |
| 9 | Portfolio overview | `show my portfolio` | 0:50 | Works now |
| 10 | Swap history | `my swap history` | 0:25 | Works now |
| 11 | Live earn review (optional) | `/vault` → Live deposit | 0:40 | Live behind flag · simulated |
| 12 | Rhea cross-chain review (optional) | `/vault/rhea-xchain` | 0:40 | Preview only · flag off |
| — | Q&A / close | — | 0:30 | — |

Total ≈ 7 minutes with no failures; ~5 minutes if you skip the long previews and optional rails.

## What's next (owner approval)

- **Funded test:** the 077 direct Kamino/Morpho flows and the 078 same-chain Rhea flow exist behind
  flags but have not moved real funds. A small funded, owner-approved test wallet is the gate before
  any “live” claim.
- **Rhea cross-chain (079):** the review is built; a live commit still needs an owner-enabled flag,
  a funded origin wallet and a real 1Click credential. Withdraw stays a guided review until a Rhea
  relayer credential exists.
- **Cross-chain earn:** 1Click Earn / receipt routes stay dry previews; 077 only adds the direct
  same-chain rail.
- Wallet signing for every move — still user-signed, still non-custodial, still never SparkPoint
  holding the funds.

Until a funded test is approved, every live-earn card says **SIMULATED** and every other card is a
dry preview or a read.

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

Related docs: [`hackathon-submission-one-pager.md`](./hackathon-submission-one-pager.md) ·
[`078-rhea-near-direct.md`](./078-rhea-near-direct.md) ·
[`specs/072-multichain-portfolio/quickstart.md`](../../specs/072-multichain-portfolio/quickstart.md).
