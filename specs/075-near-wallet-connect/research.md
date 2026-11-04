# Research — 075 NEAR wallet connect

Verified against the published package metadata (`@hot-labs/near-connect@0.12.0`) and its shipped
type declarations/README. No wallet, key, seed phrase or account signature was used: tests inject a
mock, and no network call is made by the test suite.

## Library decision

**Chosen: `@hot-labs/near-connect@0.12.0` (exact pin).**

NEAR's current guidance and the package README recommend the manifest-based connector over the
older `@near-wallet-selector/*` monolith. The features that matter here:

- Meteor is in the manifest (`id: "meteor-wallet"`) with `signMessage`, `signInWithoutAddKey`,
  `mainnet` and `testnet`; `connect({ walletId:"meteor-wallet" })` is a direct, one-click path.
- Sign-in without an access key is explicit: the connector's `connect()` calls
  `wallet.signIn({ addFunctionCallKey: undefined })`. There is no `contractId` / function-call key
  in our call; the adapter never passes `addFunctionCallKey` or the deprecated `signIn` option.
- `signMessage({ message, recipient, nonce })` is a NEP-413 off-chain signature. The adapter's
  public surface deliberately omits every transaction method.
- The package is ~51 KB packed, zero runtime dependencies (only type-only `@near-js/*` devDeps),
  and `type: commonjs` bundles cleanly through Next.

### Trade-offs recorded

| dimension | `@hot-labs/near-connect@0.12.0` | `@near-wallet-selector/core` + `meteor-wallet@10.1.4` |
|---|---|---|
| supply chain | one small package; wallet executors are remote but sandboxed and manifest-reviewed | a modular family plus a modal/UI package tree; heavier install surface |
| CSP | needs `connect-src` for the manifest + `script-src` for sandboxed executors (below); supports `cspNonce` | needs its own bundle + wallet module origins; no manifest indirection |
| bundle | lazy-loaded only on first NEAR action | core + Meteor module + modal; larger client bundle |
| mockability | the adapter is thin; the window hook replaces it wholesale for e2e | needs mocking the selector service/state; more internals to fake |
| Meteor-first | `walletId: "meteor-wallet"` | picker/config ordering, no single preferred-id connect |
| key safety | `signInWithoutAddKey` is a named feature | also supported, but the surrounding module historically exposes more |

The alternative would work, but it brings a heavier modal and more code to mock for the same
account-only + sign-message scope. The chosen package is also the one NEAR's docs currently point
at.

## CSP origins (recorded, not added)

The app sets **no `Content-Security-Policy` today** (`next.config.ts` has no `headers()` and there
is no middleware CSP), so this change adds none. If a CSP is introduced later, the minimal
allowance for this feature is:

- `connect-src`: `https://raw.githubusercontent.com` (default manifest and Meteor executor) and
  `https://cdn.jsdelivr.net` (the library's fallback manifest mirror).
- `script-src` (for the `srcdoc` sandbox iframe, which inherits the parent CSP): the same two
  origins. When a nonce-based policy is used, pass the page nonce to `NearConnector({ cspNonce })`
  (already wired from `document.querySelector("script[nonce]")`); otherwise the iframe's inline
  bridge scripts are blocked.
- No `frame-src` entry is needed for the sandbox: it is a local `srcdoc` iframe, not a remote
  frame. Wallet-initiated external links use the wallet's own UI.

`walletconnect`-only wallets are NOT enabled (no WalletConnect project is passed), which keeps the
allowance smaller. Meteor does not require it.

## SSR / build behaviour

The connector touches `window`, IndexedDB and the DOM, so the import is dynamic and only reached
from an event/effect (never module top-level). `NearWalletProvider` creates the adapter lazily, and
`nearNetworkFromEnv()` is a pure `process.env` read inlined by Next. A production build with no
NEAR env succeeds (verified locally).

## Test/e2e hook

`window.__SP_NEAR_WALLET_MOCK__` is read only when the inlined build constant
`NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK === "true"`. The Playwright spec installs it before navigation
and its `signAndSendTransaction` / `signTransaction` methods throw and record a call, so the spec
can prove the sign-only path never reaches a transaction. Production builds leave the constant
unset, so the mock cannot be used there.

## Agent / BFF boundary

The BFF derives `x-owner` / `x-account` from the verified SIWE cookie; the browser cannot assert an
identity. The agent's chat request schema has no NEAR account field, and 071/072 derive the Rhea
MCA from the session EVM wallet. Therefore 075 changes no agent/request schema: the NEAR account is
a client-side display/prefill claim only. This is intentionally the smallest safe integration.

## Residual risks / open questions

1. **Remote code.** Wallet executors are fetched from a manifest. Sandboxing and manifest
   permissions are the mitigation; a future strict CSP should be tested with the Meteor flow.
2. **Unpinned manifest.** The library fetches `main` at runtime; the package version is pinned but
   the manifest is not. If the client wants full supply-chain determinism, self-host the manifest
   and pass `manifest:` (a one-line adapter change).
3. **Phase C recipient string.** The Rhea NEP-413 `recipient` is set to `app.rhea.finance` as the
   human-facing app id. If Rhea specifies a different NEP-413 recipient for production, change the
   single constant in `phaseC.ts`.
4. **No NEAR balances.** 072 has no NEAR account input or balance read; the UI says so rather than
   inventing a number. A future read-only NEAR RPC path can use `NEXT_PUBLIC_NEAR_RPC_URL`.

## Verification (local, before push)

- Web: `pnpm install --frozen-lockfile`; `tsc --noEmit`; `typecheck:test`; unit tests **894 pass**;
  `eslint` clean; `next build` with **no NEAR env** set.
- Playwright `e2e/pw/near-wallet.spec.ts` against a local production build with the mock hook:
  **4/4 passed** with `NEXT_PUBLIC_NEAR_PHASE_C_SIGN=true` (sign-only exercised) and **4/4 passed**
  with the flag unset (no sign button rendered). No wallet key, no network transaction.
- Agent (because `content_seed/whats-new.json` changed): `ruff check .` clean, `mypy
  src/sparkpoint_agent` clean, full `pytest -q` **2957 passed** with the CI `SPARKPOINT_VAULT_ABI_PATH`.
- Replicated PR gates: custody-seam (statement grep) clean; knowledge-boundary clean; policy-parity
  chain 84532 **6/6 fields OK**; vault-eligibility **4/4 candidates pass**; changelog-required
  prerequisites present (CHANGELOG added lines + `whats-new.json` changed). `gitleaks` is not
  installed in this workspace (not run); no secret/key material was added.
