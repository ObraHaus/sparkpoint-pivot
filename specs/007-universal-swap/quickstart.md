# Quickstart: Universal Swap

How to run and verify the feature locally + on the dev/staging (alpha) environment.

## Prerequisites

- Node 20 (`.nvmrc`), pnpm 9 (NOT 11 — see the pnpm-version trap; use pnpm 9 for any dep change).
- A wallet (MetaMask/Coinbase/WalletConnect) with test funds on Base Sepolia (84532) and/or Robinhood
  Chain Testnet (46630). Use the in-app Faucets panel for Base Sepolia test USDC.
- `pnpm install --frozen-lockfile` at the repo root.

## Run the web app

```bash
pnpm --filter @sparkpoint/web dev      # Next.js dev server
```

Open `/swap`. With no wallet connected the page previews on Base Sepolia (the default preview network) and
does not persist any pasted token.

## Verify by user story

**US1 — swap into a custom token (direct pool).** Connect on Base Sepolia. Keep USDC as "you pay". In "you
receive", open the picker → paste a token address that has a direct pool. Confirm: the resolved
symbol/name/decimals appear, an **unverified** badge shows, and (for a symbol that collides with USDC) a
"NOT the official USDC" warning shows with the address. Enter an amount → a live quote shows output net of
the 0.20% fee + minimum received. Acknowledge the unverified token, Review, and sign. Output (net of fee)
lands in your wallet; the fee lands on-chain at the disclosed recipient.

**US2 — multi-hop.** Pick a pair with no direct pool but a WETH path. Confirm the route summary shows
`TOKEN → WETH → TOKEN`, price impact is honest (or "unavailable"), and the signed swap delivers the
received token net of the 0.20% fee. Then switch networks in the wallet and confirm the token selection
resets to that network's recommended tokens.

**US3 — fee everywhere.** On a network configured with `swapFeeRecipient` (incl. 46630 once the probe
passes), complete a swap and confirm the receipt figures equal what was shown and the recipient received
0.20% on-chain. On a network where the fee can't be collected on-chain, confirm the UI shows **no** fee and
states the swap is fee-free there. Check `/fees` discloses the active-network recipient.

**US4 — chat parity.** In `/chat`, have the assistant propose a swap into a custom token. Confirm the
inline card shows the token with an unverified badge + address, quotes with the 0.20% fee, and executes
user-signed like `/swap`. Confirm a proposal for a different network prompts a switch.

## Tests

```bash
pnpm --filter @sparkpoint/web test        # node:test units + component tests
# Focused units:
pnpm --filter @sparkpoint/web test path.test.ts route.test.ts metadata.test.ts math.test.ts
pnpm --filter @sparkpoint/web exec playwright test e2e/pw/swap-custom-token.spec.ts   # e2e (long hydration budget)

# Agent proposal changes:
cd services/agent && uv run pytest tests/coordinator tests/agents -q

# Green gate before any PR:
pnpm -w typecheck && pnpm -w lint && pnpm -w build
```

## Honest-state matrix (manual smoke)

| Case | Expected |
|---|---|
| Not-a-token / EOA address | refused, no quote |
| Direct pool only | single-hop route, fee applied |
| Only 2-hop via WETH | multi route, fee on final output |
| No route at all | `noRoute` (fail-closed) |
| Transport/RPC error | retryable `isError`, not `noRoute` |
| Fee-on-transfer output token | quote shown, honest "may deliver less" warning |
| Unverified token | ⚠ badge + address + acknowledgement gate at signing |
| Duplicate symbol (fake USDC) | "NOT the official USDC" + address |
| Fee chain, recipient pending | Review/Confirm blocked (never fee-free) |
| Fee can't be collected on-chain | no fee shown; "fee-free on this network" |
| Network switch mid-session | tokens reset to that chain's recommended |

## Living docs to update before "done"

- `CHANGELOG.md` — dev bullet under `## [Unreleased]` for each phase.
- `services/agent/content_seed/whats-new.json` — a client-facing entry per user-visible phase (A/B/C/D).
- `DEVELOPMENT.md` — document `swapFeeRecipient` (address book) + the `sp.swap.imported.v1` localStorage key.
- `/fees` in-app copy — per-network recipient + "applies on every supported network".
