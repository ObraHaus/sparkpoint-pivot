# ops/testnet-bots

Operator tool. Drives **real product activity on the testnets the alpha already reads**, so the
revenue and portfolio surfaces have something honest to show before the first whitelisted tester
arrives.

Nothing here ships. Nothing here can reach a mainnet.

## Why this exists

Measured on 2026-08-18, across the develop database and both testnets:

| | |
|---|---|
| routing-fee events, ever | **8** (2.18 test-USDC, last one 30 July) |
| vault performance-fee events, ever | **0** |
| brokers carrying a tiered payout weight | **1** of 12 minted |
| users | **4** |

So every revenue surface reads zero or near-zero, and none of that is a code defect — there is
simply almost no activity. This tool creates the activity, using the same contract calls the app
makes, so the rows that appear are the rows a real user would have produced.

## The honesty obligation

**This produces the volume. It does not prove the demand.** Everything it generates is ours.
It must never be presented as adoption, and the amounts must never be shown as a forecast —
the app's own copy audit (feature 044) exists to enforce exactly that on the client-facing side.

## Install

```sh
cd ops/testnet-bots
npm install          # outside the pnpm workspace on purpose — it must not touch the app lockfile
```

## Use

Everything is a **dry run** unless you pass `--broadcast`.

```sh
# read-only snapshot: balances, caps, vault TVL, whether a fee is realisable right now
node --experimental-strip-types src/bot.ts status --chain 84532

# create the bot wallets (prints a mnemonic to store in .env, then funds them)
node --experimental-strip-types src/bot.ts fund --chain 84532 --wallets 20 --broadcast

# realise the vault performance fee — permissionless, anyone may call it
node --experimental-strip-types src/bot.ts accrue --chain 84532 --broadcast

# deposits (clamped to the 5,000 USDC per-wallet cap and to each wallet's balance)
node --experimental-strip-types src/bot.ts vault --chain 84532 --wallets 20 --broadcast

# fee-bearing swaps — ROBINHOOD ONLY (84532 is refused: its pool is too shallow)
node --experimental-strip-types src/bot.ts swap --chain 46630 --count 40 --wallets 20 --broadcast

# mint + activate brokers across all three tiers. ⚠️ IRREVERSIBLE — retires SRK permanently.
node --experimental-strip-types src/bot.ts brokers --chain 46630 --wallets 6 --broadcast
```

### Environment

| Variable | Used by | Notes |
|---|---|---|
| `BASE_SEPOLIA_RPC_URL` | all | falls back to `https://sepolia.base.org` |
| `DEPLOYER_PRIVATE_KEY` | `fund`, `accrue` | the funder only — bots never use it |
| `BOT_MNEMONIC` | `fund`, `vault`, `swap` | derives the bot wallets; `fund` mints one if unset |

Keys live in the workspace keystore (`.env`), never in the repo. The bot mnemonic is the
bots' **own** — do not reuse the project's testnet wallets, and never the Robin Brokers ones.

## Running it on a schedule

The runner owns its cadence. Nothing in the deployed app can start, stop or re-time it — the agent
is provably keyless and putting these keys behind it would end that.

```sh
./run-cycle.sh                 # dry run: swaps on Robinhood + accrue on Base Sepolia
./run-cycle.sh --broadcast     # one real cycle

# hourly, unattended:
cp sparkpoint-bots.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now sparkpoint-bots.timer
```

⚠️ **Keep the timer and `BOT_INTERVAL_SEC` in step.** The runner tells the panel its cadence and the
panel judges lateness against it, so a mismatch shows as a fleet that is permanently overdue while
nothing is actually wrong.

### Reporting to the admin panel

With `AGENT_BASE_URL` and `AGENT_S2S_TOKEN` set, each `--broadcast` run posts what it did to
`POST /admin/bots/runs`, and **Admin → System → Activity bots** renders it. Unset, the bots work
exactly the same and the panel honestly says no runner has ever reported.

The report separates **attempted** from **succeeded** on purpose: a run where every action was
refused still finishes cleanly, and the panel's `failing` state is derived from that gap. Reporting
is best-effort — a failed POST is logged but never turns a good run into a bad one.

## What keeps this safe

1. **A positive chain allowlist.** Only `84532` and `46630`. The id is read from the **live
   connection** and compared against the requested one, so an RPC URL pointing somewhere else is
   caught rather than trusted. A blocklist would be one forgotten entry from signing on mainnet.
2. **Dry run by default.** A tool that moves money as a side effect of being run is a tool that
   moves money by accident.
3. **Simulate, then send.** Every write is `simulateContract`-ed first, so a revert is reported
   with its reason and costs nothing.
4. **Caps are read, not assumed.** Deposits clamp to `maxDeposit(bot)` — the on-chain per-wallet
   ceiling — and to the wallet's balance.

## Things worth knowing before you run it

- **⚠️ Pool depth is the real constraint — not funds, not gas.** Measured 2026-08-18:

  | pool | WETH | USDC | implied |
  |---|---|---|---|
  | Base Sepolia tier 500 | **0.0338** | 105 | ~3,104 USDC/ETH |
  | Base Sepolia tier 3000 | 0.1805 | 249 | ~1,381 USDC/ETH |
  | Robinhood tier 3000 | **2,311.7** | 133,361 | ~58 USDC/ETH |

  Base Sepolia's tier-500 pool holds **less WETH than the funder's own balance**. Bot volume
  there would visibly move the price a real tester is quoted, so **swapping on 84532 is disabled
  in config** and the tool refuses it by name. Swaps run on Robinhood, where a 0.02 ETH trade is
  immeasurable.

- **⚠️ The pool tier is PINNED, never quote-shopped.** Both testnets carry a large cross-tier
  dislocation (Base Sepolia 3,104 vs 1,381; Robinhood 185 vs 58). Taking the best quote per
  direction buys in one pool and sells in the other, so a "round trip" returns **+172%** — that is
  an arbitrage bot, which drains the thin side and moves the quoted price. Pinned to one deep
  pool the round trip costs a flat **0.996%** at every size, which is the honest 0.3%×2 pool fee
  plus 0.2%×2 ours.

- **A live depth guard backs it up.** Reserves are read from the pool before every trade and
  anything above 0.50% of them is refused, so a mistyped `--amount` cannot move the market.

- **Gas is not the constraint.** Measured from the real July swaps: **0.00000084 ETH** per swap on
  Base Sepolia (L1 fee included, ~1.5% of it) and **0.0000019 ETH** on Robinhood. The current
  balances buy tens of thousands of swaps.
- **TVL scales by wallets, not by money.** The vault's per-user cap is 5,000 USDC and the global
  cap is 1,000,000. Test USDC is mintable from the Aave-market faucet, which is rate-limited **per
  address** — so 20 wallets is 100k of TVL and 200 wallets is the full cap.
- **The vault has no on-chain whitelist.** Deposits are gated by caps alone; the allowlist is an
  app-level gate on the UI. Bots deposit directly and legitimately.
- **Yield needs time, not deposits.** The performance fee is 10% of yield above the high-water
  mark, and Aave pays ~1.68% APR on USDC here. Deposit first, `accrue` later — `status` tells you
  whether there is anything to realise.
- **⚠️ The SRK faucet cannot fund activations, and this is not close.** It pays 5,000 SRK per
  address per 24h against an Analyst tier of **250,000** — fifty days of claims for one activation,
  two hundred for a Partner. Bots are funded from the deployer's balance instead (987M of a 1B
  fixed supply); `fund --chain 46630` does it, sized to each wallet's assigned tier. The faucet is
  left for actual humans trying the product.
- **⚠️ Activation is IRREVERSIBLE.** The SRK is retired to a dead address in the same transaction,
  there is no `withdraw`/`rescue` by design, and a later transfer clears the activation with no way
  to rebuild the record. An activated broker must stay with the wallet that activated it — the
  bots mint, activate, and then leave those tokens alone.
- **⚠️ Sell-leg fees are invisible to the indexer.** A sell pays its 0.20% in **native ETH** via
  `unwrapWETH9WithFee`, which emits no ERC-20 `Transfer`; `swap_fee_indexer` matches only ERC-20
  `Transfer` logs. The fee is really received and never counted. That is a gap in revenue
  accounting that **affects real users too**, not an artefact of the bots.
