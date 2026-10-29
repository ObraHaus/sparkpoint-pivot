# Browser e2e (Playwright + injected wallet) — R4 #18

A headless-Chromium suite that drives the **real** non-custodial flow with a **fake injected
EIP-1193 wallet** ([`injected-wallet.ts`](./injected-wallet.ts)) — the wallet is a real viem account
whose `personal_sign` is signed in Node (the key never enters the browser), so connect → SIWE →
session runs end-to-end without a wallet extension. Complements the Node gate-matrix in
[`../auth.e2e.mjs`](../auth.e2e.mjs).

## Scenarios

- **public-routes.spec.ts** (no wallet): landing renders; `/exit` + `/trust` are reachable without a
  wallet and never gated; a protected route bounces an unauthenticated visitor to `/connect`.
- **f061-ux-quick-fixes.spec.ts** (injected wallet, agent mocked in-browser): What's New is a
  non-blocking panel shown once per release (`PW_FORCE_REFRESH=1`); Strategies is absent when
  there is nothing to rank; the 390px header does not overflow; the trust banner dismissal
  persists; a slow chat turn says so and Retry resends; thumbs POST `/chat/feedback`. Never calls
  beta or a live agent.
- **connect-siwe.spec.ts** (injected wallet): the wallet auto-connects and `/connect` advances to
  `/verify`; the SIWE signature mints a session and admits a beta-allowlisted wallet ("You're in.",
  beta eligible); an authenticated wallet opens a protected app route (the live portfolio).
- **wallet-switch.spec.ts** (injected wallet, two accounts): the SIWE session stays bound to the
  connected wallet. FORWARD — sign in with a non-allowlisted wallet ("not in the alpha yet"), switch
  the extension to an allowlisted wallet, and the app clears the stale session and re-offers sign-in
  (then admits it). REVERSE — sign in with an allowlisted wallet, switch to a non-allowlisted one,
  and the next protected navigation bounces to `/connect` (no stale beta-pass) while `/exit` stays
  open. Needs `PW_TEST_PRIVKEY_NONBETA` in addition to `PW_TEST_PRIVKEY`.

## Running

```bash
pnpm --filter @sparkpoint/web e2e:pw:install     # one-time: fetch Chromium
# Serve a production build wired to the deployed agent, gate off:
export SITE_LOCKED=false NEXT_PUBLIC_SITE_LOCKED=false
export SESSION_SECRET=<any-test-secret>
export NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=<base-sepolia-rpc>
export NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown-id>
export AGENT_INTERNAL_URL=<agent-fqdn> AGENT_S2S_TOKEN=<s2s-token>
export PW_TEST_PRIVKEY=<0x… key of a BETA-allowlisted test wallet>   # else SIWE specs skip
export PW_TEST_PRIVKEY_NONBETA=<0x… key of a NON-allowlisted test wallet>  # else wallet-switch skips
pnpm --filter @sparkpoint/web build
pnpm --filter @sparkpoint/web e2e:pw
```

`playwright.config.ts` starts `next start` on :3000 (set `PW_BASE_URL` + `PW_NO_SERVER=1` to target a
running server instead). The SIWE specs `test.skip` when `PW_TEST_PRIVKEY` is unset, so the public
suite runs anywhere. The test wallet must be on the agent's **beta** allowlist for the admit check.

> Never point `PW_TEST_PRIVKEY` at a wallet holding real funds — it's a throwaway testnet key.

## Universal-swap specs (feature 007)

- **swap-universal.spec.ts** (injected wallet, no broadcast): `/swap` resolves a pasted custom token
  on-chain + badges it unverified + refuses a non-contract; a live ETH→USDC quote carries the 0.20%
  routing fee + a route; and the in-chat swap card renders (agent proposes → Review → routing fee).
- **real-swap.spec.ts** + **broadcasting-wallet.ts** — **GATED, FUNDED, REAL on-chain**: signs AND
  broadcasts a genuine ETH→USDC swap (moves testnet funds). `broadcasting-wallet.ts` backs
  `window.ethereum` with a Node viem walletClient (signs + sends `eth_sendTransaction`; other RPC methods
  proxied), so the app's real user-signed swap runs headless. Skipped unless `PW_REAL_SWAP=1` + a funded
  `PW_TEST_PRIVKEY`, so it never runs in normal CI.

  ```bash
  export PW_BASE_URL=https://alpha.sparkpoint.io PW_NO_SERVER=1
  export PW_REAL_SWAP=1 PW_TEST_PRIVKEY=<0x… funded testnet key>
  export PW_SWAP_CHAIN=84532        # or 46630 (Robinhood)
  export PW_SWAP_SURFACE=swap       # or chat
  export PW_SWAP_AMOUNT=0.0003
  pnpm --filter @sparkpoint/web exec playwright test e2e/pw/real-swap.spec.ts
  ```

  Validated all four combos (Base Sepolia + Robinhood × /swap + chat) — each tx confirmed on-chain and
  collected the 0.20% routing fee to the recipient.

## Chat streaming spec (feature 059)

`chat-streaming.spec.ts` asserts that a streamed Sparky answer paints its first token in under
2.5 s, that the first paint is only a PARTIAL prefix (063 — the final answer must land later),
and that the final `text` block reconciles (removes) the provisional paint. It never calls
the beta agent: a local SSE server stands in for the agent, and the session cookie is signed
locally with the same `SESSION_SECRET` the app under test uses.

```bash
# 1. start the streaming mock agent (Node, no deps)
PW_MOCK_AGENT_PORT=4319 node apps/web/e2e/pw/mock-agent-sse.mjs &

# 2. build + run the app against it
export SITE_LOCKED=false NEXT_PUBLIC_SITE_LOCKED=false
export SESSION_SECRET=<any-test-secret>
export AGENT_INTERNAL_URL=http://127.0.0.1:4319 AGENT_S2S_TOKEN=test
export PW_TEST_PRIVKEY=<0x… throwaway key> PW_MOCK_AGENT=1
pnpm --filter @sparkpoint/web build
pnpm --filter @sparkpoint/web exec playwright test e2e/pw/chat-streaming.spec.ts
```

The spec skips unless `PW_TEST_PRIVKEY`, `SESSION_SECRET` and `PW_MOCK_AGENT=1` are set, so it can
never accidentally hit beta.
