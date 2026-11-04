# Spec 075 — NEAR wallet connect (Meteor first), web only

**Status:** implemented on `feat/075-near-wallet-connect` · **Base:** `origin/develop`
(`3e10c12`) · **Worktree:** `~/project/sparkpoint-pivot-075`

## Problem

SparkPoint's web app can connect an EVM wallet (wagmi + SIWE) but has no NEAR wallet. NEAR appears
in 068 (wrapped NEAR in cross-chain routes), 071 (Rhea lending) and 072 (read-only portfolio), yet
the user must paste a NEAR recipient and the Rhea Phase C step is only a placeholder. A user with a
Meteor wallet cannot show their NEAR account, and a cross-chain swap to NEAR cannot prefill their
own address.

## Requirements

- **R1 — Adapter + provider.** A `NearWalletProvider` / `useNearWallet` hook sits behind a small
  adapter interface: `connect`, `disconnect`, `accountId`, `signMessage(NEP-413)` only. No
  transaction method exists on the interface. The connector client is loaded client-side only
  (dynamic import; no SSR crash). A test/e2e mock can be injected via a window hook that exists
  only when a build-time flag is set; production ignores it.
- **R2 — Network env.** `NEXT_PUBLIC_NEAR_NETWORK` (`mainnet` default; `testnet`; invalid ⇒
  mainnet) and optional `NEXT_PUBLIC_NEAR_RPC_URL` (read-only lookups only). Names documented in
  `DEVELOPMENT.md` / `COOLIFY.md`; no value is set by this change.
- **R3 — Connect UI.** A "Connect NEAR wallet" control beside the EVM wallet UI (Meteor first),
  showing the connected account id (long implicit ids truncated) and disconnect. It must not read,
  write or invalidate the EVM/SIWE session.
- **R4 — Portfolio.** Show the connected NEAR account id in the wallet UI and the 072 portfolio
  (chat card + `/portfolio` panel). 072 has no NEAR-account input or balance read path, so show an
  honest "NEAR balances coming soon" note instead of inventing data.
- **R5 — Cross-chain.** When the destination is NEAR and the user has not overridden the
  recipient, prefill the connected NEAR account id (still editable and validated). EVM behaviour is
  unchanged.
- **R6 — Rhea card.** Use the connected NEAR account as the Rhea signer/account identity; keep a
  pasted account as a display-only fallback when no wallet is connected; state which is used. The
  server-derived MCA remains the funds recipient.
- **R7 — Phase C sign-only.** Wire the "sign in your wallet" step to the connector's
  `signMessage` (NEP-413) ONLY when the Phase C flag is on. With the flag off it stays exactly the
  existing placeholder/disabled state. The signature is never submitted, deposit stays disabled,
  no new flags are flipped on, and no transaction is built or broadcast.
- **R8 — Changelogs + artifacts.** `CHANGELOG.md` `[Unreleased]` entry, a client-facing
  `services/agent/content_seed/whats-new.json` entry, and these Spec Kit docs.
- **R9 — Safety.** Sign-in adds NO access key (`signInWithoutAddKey`; no `contractId`-bound login).
  No key, seed phrase or access key is generated, stored, logged or committed. `.gitignore` gains
  `.claude/near-wallet.txt` / `**/near-wallet*.txt`.

## Non-goals

- No transaction, no access key, no on-chain write, no deposit enablement (Phase C execution stays
  out of scope).
- No agent/BFF schema change: the agent does not need the NEAR account id (071 derives the Rhea MCA
  from the session EVM wallet; 072 reads Rhea the same way). The NEAR account is never server auth.
- No workflow, Defender, secrets, Coolify/deploy env, LiteLLM, model, billing or quota change.
- No new CSP is introduced (the app currently sets none).

## Acceptance

1. `pnpm install --frozen-lockfile` passes with the pinned `@hot-labs/near-connect` version.
2. Without any NEAR env, the build, typecheck, unit tests, lint and `next build` pass.
3. Unit tests cover network parsing, account validation/truncation, recipient auto-fill, Rhea
   account selection, Phase C gating and the no-transaction guarantee.
4. Playwright `e2e/pw/near-wallet.spec.ts` (mocked NEAR wallet + mocked agent) drives connect →
   id in wallet UI + portfolio → NEAR recipient prefill → Rhea sign-only → disconnect, and asserts
   no forbidden transaction method was called.
5. Cross-chain EVM destinations and the EVM/SIWE session behave exactly as before.
