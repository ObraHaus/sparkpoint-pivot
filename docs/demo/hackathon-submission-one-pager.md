# SparkPoint Pivot — hackathon submission one-pager

**The first AI-native, non-custodial multi-chain DeFi assistant.** SparkPoint shows you your whole
portfolio across chains, answers in plain language, and prepares every move for you to review and
sign in your own wallet. It never holds keys, funds or custody.

**Beta:** <https://beta.sparkpoint.io> · **Docs:** [`docs/demo/072-hackathon-demo.md`](./072-hackathon-demo.md)

---

## What makes it different

1. **Dual access.** Every core capability exists twice: a manual page and Sparky chat. The two
   surfaces read the same registry and cannot disagree about a chain, protocol or rail.
2. **Multi-chain by design.** NEAR Intents (1Click) cross-chain swaps, Morpho on Base/Ethereum,
   Kamino on Solana, Rhea on NEAR, and a read-only portfolio that spans them without asking you to
   flip networks in MetaMask.
3. **Safety first.** Live earn is **off by default**. When an owner enables a flag, SparkPoint builds
   an **unsigned** transaction; you review it and sign in your own wallet. Until a funded test is
   approved, execution is explicitly **SIMULATED**.
4. **No custody, ever.** There is no SparkPoint key that can move your funds. Withdrawals are not
   gated by SparkPoint.

## Dual access — manual pages and chat

| Capability | Manual | Sparky chat |
|---|---|---|
| Same-network EVM swap | `/swap` (Base or Robinhood Chain) | — |
| Cross-chain swap | links to Sparky | “swap 50 USDC to SOL” |
| Earn registry | `/vault` | “Show Morpho vaults on Base”, “Show Kamino vaults”, “earn yield on NEAR” |
| Live earn review | `/vault` → `/vault/live` | earn card → same review |
| Rhea cross-chain review | `/vault` → `/vault/rhea-xchain` | Rhea card → same review |
| Portfolio | `/portfolio` → Across chains | “show my portfolio” |

## Multi-chain rails

| Rail | Chain(s) | What the beta does | Live status |
|---|---|---|---|
| **NEAR Intents (1Click) swaps** | Base, Ethereum, Solana, NEAR, Bitcoin destination | Quote + preview, destination and fees, then send from your own wallet to a one-time deposit address; incomplete swaps are refunded | Live where the rail and keys are configured |
| **Morpho** | Base, Ethereum | Curated lending vaults; net APY as Morpho reports it; dry deposit preview | Read/preview live; direct live review **flag off** |
| **Kamino** | Solana | SOL/USDC vaults; the 1Click receipt is the native Kamino vault share; pasted Solana recipient, never an EVM address reused | Read/preview live; direct live review **flag off** |
| **Rhea (Burrow) same-chain** | NEAR | Native USDC supply/withdraw with a connected NEAR wallet; storage/gas reserve shown; receipt polled honestly | Built; **flag off** |
| **Rhea (Burrow) cross-chain** | Base/Ethereum → NEAR | 1Click + Rhea Multichain Account review; one-time MCA fee, routing fee, net supplied, APY | Review only; live commit **flag off** |
| **Portfolio** | Base, Solana, NEAR | Read-only balances, Morpho/Kamino/Rhea positions and swap history; each section degrades honestly | Live (read-only) |

## Live-earn safety — flags OFF by default

Live earn is a deliberate, reversible opt-in. Nothing signs or sends until an owner enables it.

| Flag (browser) | Server flag | Rail |
|---|---|---|
| `NEXT_PUBLIC_EARN_LIVE_KAMINO` | `EARN_LIVE_KAMINO` | Kamino direct on Solana |
| `NEXT_PUBLIC_EARN_LIVE_MORPHO` | `EARN_LIVE_MORPHO` | Morpho direct on Base |
| `NEXT_PUBLIC_EARN_LIVE_RHEA` | `EARN_LIVE_RHEA` | Rhea same-chain on NEAR |
| `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN` | `EARN_LIVE_RHEA_XCHAIN` | Rhea cross-chain review + gated commit |

- **Default off.** With the flags unset, the beta shows previews and reads only; the live entry
  points are absent.
- **Unsigned review only.** When enabled, SparkPoint builds an **unsigned** transaction, shows the
  exact amount, accounts, fees and rent, and hands it to your wallet. SparkPoint never signs,
  approves, submits or broadcasts.
- **Simulated until funded.** No funded execution has been run. Simulation scripts print
  **SIMULATED**; an unfunded probe fails honestly rather than pretending success.
- **No custody.** No SparkPoint key, no access key added, no allowance beyond the exact transaction
  you sign.

## Withdraw postures (precise)

| Rail | Withdraw today | Custody |
|---|---|---|
| 077 Kamino / Morpho | In-wallet unsigned withdraw/redeem review → your wallet signs | None |
| 078 Rhea same-chain | In-wallet unsigned Burrow `execute → Withdraw` review → your NEAR wallet signs | None |
| 079 Rhea cross-chain | **Guided review only**: documented Rhea SDK paths (`relayer`, `nearMcaWithdrawTx`) first, Rhea app link-out last; no in-app signed withdraw | None |
| 071 Rhea preview | External link to `app.rhea.finance` | None |

A Rhea app link-out is **not** a SparkPoint-signed transaction, and SparkPoint does not invent a
relayer or custodian it does not have.

## Preview vs live — the honest line

| Claim | True today? |
|---|---|
| Manual `/swap` swaps on your connected EVM network | **Yes**, user-signed |
| Cross-chain swaps quote through NEAR Intents 1Click | **Yes**; sending is your own wallet transfer where configured |
| Morpho, Kamino and Rhea vault lists and dry previews work | **Yes** |
| Portfolio reads across Base, Solana and NEAR | **Yes**, read-only |
| Live Kamino/Morpho/Rhea deposit or withdraw is enabled on the beta | **No** — built behind flags, off by default |
| Live cross-chain Rhea deposit is enabled | **No** — review only, live commit flag off |
| A funded live execution has been demonstrated | **No** — simulated until an owner-approved funded test |
| SparkPoint can move, freeze or withhold your funds | **Never** |

## Six-minute demo

1. Sign in at `/connect` with a throwaway wallet (free SIWE message).
2. `swap 50 USDC to SOL` — cross-chain 1Click preview.
3. `Show Morpho vaults on Base` → `Deposit 100 USDC into Morpho Gauntlet USDC Prime` — dry preview.
4. `Show Kamino vaults` → `Deposit 100 USDC into Kamino SOL vault` — native-share preview + Solana
   recipient.
5. `earn yield on NEAR` → `Deposit 100 USDC into Rhea` — Rhea list + first-deposit fee preview.
6. `show my portfolio` → `my swap history` — read-only multi-chain view.

Full run of show, fallbacks and verified prompt strings: [`072-hackathon-demo.md`](./072-hackathon-demo.md).

## Status and caveats

- **Beta, not production.** Rates are variable spot readings, not promises; deposits are not insured.
- **Live earn is flag-gated** and off by default. The beta you visit may show previews only.
- **No funded execution claim.** Every live-earn simulation is labelled SIMULATED until the owner
  approves and runs a funded test.
- **Non-custodial.** You sign every transaction; SparkPoint holds no key that can move your funds.

## Built with

NEAR Intents (1Click) · Morpho · Kamino · Rhea/Burrow · Base · Solana · NEAR · ERC-4626 · an
AI assistant grounded in a reviewed product-knowledge corpus, with deterministic parsers and a
fail-closed policy path.
