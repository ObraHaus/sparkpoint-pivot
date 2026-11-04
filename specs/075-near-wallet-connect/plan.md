# Plan — 075 NEAR wallet connect (web)

**Base:** `origin/develop` @ `3e10c12` · **Branch:** `feat/075-near-wallet-connect` ·
**Worktree:** `~/project/sparkpoint-pivot-075`.

## Design

### 1. Library

`@hot-labs/near-connect@0.12.0` (exact pin), dynamically imported. It is manifest-based, runs each
wallet in a sandboxed iframe, and supports Meteor, `signInWithoutAddKey` and `signMessage`. See
`research.md` for the decision and the rejected alternative.

### 2. Pure helpers (`apps/web/src/lib/near/`)

- `network.ts` — `parseNearNetwork`, `parseNearRpcUrl`; invalid/blank ⇒ mainnet / unset.
- `account.ts` — NEAR account-id shape check and display truncation (implicit 64-hex ids).
- `recipient.ts` — recipient precedence: explicit override → matching connected wallet → empty.
- `rhea.ts` — which NEAR account the Rhea card names: connected → pasted (display-only) →
  preview MCA → none.
- `phaseC.ts` — Phase C flag parsing, `shouldOfferRheaSign`, NEP-413 request builder (32-byte
  nonce, `recipient="app.rhea.finance"`).

Every helper is dependency-light and unit-tested directly with `node:test`.

### 3. Adapter (`adapter.ts`)

`NearWalletClient` takes an injectable connector factory + storage + optional mock. Production:
dynamic `import("@hot-labs/near-connect")`, `new NearConnector({ network, autoConnect:false,
features:{ signInWithoutAddKey:true, signMessage:true }, cspNonce })`, then
`connect({ walletId:"meteor-wallet" })`, falling back to the picker only when Meteor is not in the
manifest. It exposes NO transaction method. The mock path is read from
`window.__SP_NEAR_WALLET_MOCK__` only when `NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK=true` (build-time
constant) — in production the branch is dead code.

### 4. Provider (`NearWalletProvider.tsx`)

Client-only context: `accountId`, `network`, `rpcUrl`, `status`, `error`, `connect`, `disconnect`,
`signMessage`. The adapter is created lazily (never during SSR). A stored account id is restored
for display only. Wrapped inside `Providers`, next to — but independent of — `NetworkProvider`.

### 5. UI

- `NearWalletControl` in the top bar (beside the EVM wallet pill) and on `/connect`: Meteor-first
  connect, truncated account id, disconnect.
- `NearWalletPortfolioLine` in the 072 chat card and the `/portfolio` "Across chains" panel:
  connected id + "NEAR balances are coming soon" note.
- `crosschain-quote-card.tsx`: recipient selection uses `resolveCrossChainRecipient`, so a NEAR
  destination prefill comes from the connected NEAR wallet; edits still win.
- `earn-quote-card.tsx`: shows the connected NEAR account and, behind the off-by-default Phase C
  flag, a NEP-413 sign button. The signature is displayed as "not submitted"; deposit stays
  disabled.

### 6. CSS / mobile

`.nearPill` is hidden at the same breakpoint as `.walletPill` so the 390px header keeps its
no-overflow contract; the control remains reachable on `/connect` and `/portfolio`.

### 7. Safety

- No `signAndSendTransaction` / `signTransaction` call exists; a unit test supplies a wallet whose
  those methods throw and asserts they are never reached, plus a source guard.
- No access key: no `signIn` options with `contractId`/`addFunctionCallKey`.
- The NEAR account never crosses the BFF/agent boundary.

### 8. Verification

Web CI steps replicated locally (`install --frozen-lockfile`, `tsc`, `typecheck:test`, `test`,
`lint`, `build` with no NEAR env), the changelog + seam + policy gates replayed, and the Playwright
spec run against a local production build with the mock hook. Agent suite/ruff/mypy run because
`services/agent/content_seed/whats-new.json` changed.
