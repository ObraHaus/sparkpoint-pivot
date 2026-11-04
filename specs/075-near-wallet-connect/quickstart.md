# Quickstart — 075 NEAR wallet connect

## Web checks (same as CI)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH
cd ~/project/sparkpoint-pivot-075
pnpm install --frozen-lockfile
pnpm --filter @sparkpoint/web exec tsc --noEmit
pnpm --filter @sparkpoint/web typecheck:test
pnpm --filter @sparkpoint/web test
pnpm --filter @sparkpoint/web lint
pnpm --filter @sparkpoint/web build   # must pass with NO NEAR env set
```

## Browser e2e (mocked wallet + mocked agent)

A production build must bake `NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK=true` (and optionally
`NEXT_PUBLIC_NEAR_PHASE_C_SIGN=true` to exercise the sign-only step). Never point this at beta.

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH
cd ~/project/sparkpoint-pivot-075/apps/web
export SITE_LOCKED=false NEXT_PUBLIC_SITE_LOCKED=false
export SESSION_SECRET=<any-local-test-secret>
export NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK=true
export NEXT_PUBLIC_NEAR_PHASE_C_SIGN=true     # optional; off by default in real builds
pnpm build
pnpm exec playwright test e2e/pw/near-wallet.spec.ts
```

No EVM key is needed: the spec signs the session cookie locally for a fixed public address and the
NEAR wallet is a mock. The mock throws if `signAndSendTransaction` / `signTransaction` is ever
called.

## What to look for

- Top bar: **Connect NEAR wallet** → Meteor → the account id appears; **Disconnect** clears it.
- `/portfolio`: the same id in the "Across chains" panel plus "NEAR balances are coming soon".
- A cross-chain quote whose destination is NEAR: the recipient field is prefilled with the
  connected account and remains editable.
- A Rhea preview: the connected NEAR account is named; with Phase C on, the sign button produces a
  signature labelled "not submitted"; Deposit stays disabled.

## Env names (no values committed)

| variable | default | purpose |
|---|---|---|
| `NEXT_PUBLIC_NEAR_NETWORK` | `mainnet` | `mainnet` / `testnet`; invalid ⇒ mainnet |
| `NEXT_PUBLIC_NEAR_RPC_URL` | unset | optional read-only RPC |
| `NEXT_PUBLIC_NEAR_PHASE_C_SIGN` | unset (off) | Rhea Phase C NEP-413 sign-only gate |

The app sets no CSP today. A future CSP must allow `connect-src`/`script-src` for
`https://raw.githubusercontent.com` and `https://cdn.jsdelivr.net`; pass the page nonce to
`NearConnector({ cspNonce })` when using nonce-based CSP. Details in `research.md`.
