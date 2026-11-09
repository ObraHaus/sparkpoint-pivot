# Plan — 077 first live earn vertical slice

**Branch:** `feat/077-live-earn-kamino-morpho` (off `origin/develop`) · **Worktree:**
`/home/hello/project/sparkpoint-pivot-077` (the repo worktree used for this task).

## Goal

One shared review → confirm flow that builds **unsigned** deposit/withdraw transactions for
Kamino (Solana) and Morpho (Base), shows the exact amounts/accounts/fees, and lets the **user's
browser wallet** sign. The agent/BFF never signs, submits, approves or transfers.

Kamino first (the task's priority), then Morpho, then Rhea only if time remains (Rhea stays the
existing 071 preview/link-out; no live Rhea code in this slice).

## Non-negotiable posture

- The BFF (`apps/web/src/app/api/earn/kamino/*`) only calls Kamino's public **unsigned-tx** API.
  It never holds a key and never broadcasts.
- The browser calls the user's injected Solana wallet (`signAndSendTransaction`) only after an
  explicit "Confirm in wallet" click. Morpho reuses the existing user-signed
  `useExecuteVaultTx` (wagmi `writeContractAsync`).
- Every live surface is behind a flag that defaults **off**:
  `EARN_LIVE_KAMINO` + `NEXT_PUBLIC_EARN_LIVE_KAMINO`,
  `EARN_LIVE_MORPHO` + `NEXT_PUBLIC_EARN_LIVE_MORPHO`.
- Server-side vault allowlist: only the curated vaults listed in
  `apps/web/src/lib/earn/kaminoLive.ts` can be built. The BFF rejects any other vault.

## Architecture

### 1. Shared flags + routing

- `apps/web/src/lib/earn/liveFlags.ts` — pure parsers (`liveEarnEnabled(value)`), the two
  build-time readers (`kaminoLiveEnabledFromEnv`, `morphoLiveEnabledFromEnv`), and the shared
  route builder `liveEarnHref({protocol, chain, vault, mode, amount})` →
  `/vault/live?…`.
- `apps/web/src/app/(app)/vault/live/page.tsx` — the single **review + confirm** route used by
  both access points. Query: `protocol`, `vault`, `mode` (`deposit`|`withdraw`), optional
  `amount`, `asset`, `chain`.
- `/vault` (`EarnAcrossChains`) and the Sparky `earn-quote-card` both call `liveEarnHref` so they
  route to this page. No second flow.

### 2. Kamino (Solana)

- `apps/web/src/lib/earn/kaminoLive.ts`:
  - curated vault registry + base58/amount validation;
  - `buildKaminoRequest` / `assertBuildable` (shared by the route and tests);
  - `decodeKaminoTransaction(base64)` → `VersionedTransaction`;
  - `summarizeKaminoTransaction(tx, meta)` → `KaminoTxReview` (fee payer, program ids, instruction
    labels, network fee, priority fee, ATA count/rent, deposit lamports);
  - `estimateShares` / `estimateUnderlying` from `tokensPerShare`;
  - `parseKaminoPositions` for read-back.
- `apps/web/src/app/api/earn/kamino/prepare/route.ts` — `POST`, flag-gated, validates wallet +
  curated vault + amount, calls `https://api.kamino.finance/ktx/kvault/{deposit|withdraw}` and
  `GET /kvaults/vaults/{vault}/metrics`, returns the unsigned base64 tx + metadata. Never signs.
- `apps/web/src/app/api/earn/kamino/positions/route.ts` — `GET ?wallet=…`, reads
  `GET /kvaults/users/{wallet}/positions`, joins curated vault names + `tokensPerShare`.
- `apps/web/src/lib/solana/wallet.ts` — minimal injected-wallet adapter (Phantom/Solflare/`window.solana`):
  connect, read publicKey, `signAndSendTransaction`. No signing on connect; only the explicit
  method signs.
- `apps/web/src/components/vault/KaminoLiveFlow.tsx` — amount → build → review (amounts, accounts,
  fees, vault fee, rent) → confirm in wallet → signature → position read-back.

### 3. Morpho (Base)

- `apps/web/src/lib/earn/morphoLive.ts`:
  - curated vault registry (`Gauntlet USDC Prime` on Base, asset/share decimals);
  - `buildMorphoDepositPlan` (approve leg only when allowance is short) and
    `buildMorphoWithdrawPlan`, pure and unit-tested;
  - `formatMorphoReview` amounts/fees copy.
- `apps/web/src/components/vault/MorphoLiveFlow.tsx` — live reads (`asset`, `decimals`,
  `balanceOf`, `previewDeposit`, `allowance`, `previewRedeem`, `convertToAssets`), gas estimate via
  the public client (`estimateGas` — read-only), review, and the existing user-signed
  `useExecuteVaultTx` for approve+deposit / redeem.
- Flag `NEXT_PUBLIC_EARN_LIVE_MORPHO`; the page is inert (and the server flag is not consulted)
  until it is on.

### 4. Rhea (NEAR)

Out of scope for live execution this round. The existing 071 preview, NEP-413 sign-only step and
`app.rhea.finance/lending` withdraw link are unchanged. `tasks.md` records it as a follow-up.

### 5. Tests + simulations

- Web unit tests (`node --experimental-strip-types --test`):
  `liveFlags.test.ts`, `kaminoLive.test.ts` (request validation, amount maths, tx summary from a
  committed unsigned-tx fixture, position parsing), `morphoLive.test.ts` (approve-needed logic,
  decimal handling, plan validation), `solanaWallet.test.ts` (connect never signs; explicit
  submit calls the provider once).
- `scripts/earn-sim/kamino-sim.mjs` — fetches a real unsigned deposit+withdraw for the public
  Solana probe from Kamino, then calls read-only `simulateTransaction` on the public Solana RPC.
  Prints `SIMULATED`.
- `scripts/earn-sim/morpho-sim.mjs` — Base public RPC: `eth_call` reads + `eth_estimateGas` for
  the unfunded probe deposit/redeem. Expected: insufficient funds / balance revert. Prints
  `SIMULATED`.
- Lint/typecheck/tests for `@sparkpoint/web`; agent `pytest`/`ruff`/`mypy` only if agent code is
  touched (it is not planned, but run a smoke check).

### 6. Docs

`CHANGELOG.md`, `services/agent/content_seed/whats-new.json`, this spec, and
`docs/demo/072-hackathon-demo.md` state plainly: live earn is behind a flag, the review is real,
the wallet signs, and execution remains **simulated only until an owner-approved funded test**.

## Env (names only)

| name | scope | default | purpose |
|---|---|---|---|
| `NEXT_PUBLIC_EARN_LIVE_KAMINO` | web build | off | show the Kamino live entry points |
| `EARN_LIVE_KAMINO` | web server | off | allow the Kamino build proxy |
| `NEXT_PUBLIC_EARN_LIVE_MORPHO` | web build | off | show the Morpho live entry points |
| `EARN_LIVE_MORPHO` | web server | off | allow the Morpho flag to be considered |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | web build | public mainnet RPC | read-only fee/position RPC |
| `SOLANA_RPC_URL` | web server | public mainnet RPC | read-only simulation/position RPC |

No secret is read, logged or committed. `AURORA_INTENTS_API_KEY` / `ONECLICK_API_KEY` are untouched.

## Acceptance

1. With flags off, `/vault` and the earn chat card are byte-identical to before apart from no live
   CTA; `/vault/live` says live earn is disabled.
2. With `NEXT_PUBLIC_EARN_LIVE_KAMINO=true`, a /vault row and the chat card both open
   `/vault/live?protocol=kamino&…`; the same component renders the review.
3. The BFF returns an **unsigned** v0 transaction; review lists exact amount, vault, share mint,
   program ids, network fee and ATA rent; no Kamino/SparkPoint hidden fee.
4. Confirm calls the injected wallet once; the UI shows the signature and reads the position back.
5. Morpho shows approve (only when needed) + deposit, or redeem, with asset 6 dp and share 18 dp.
6. Simulation scripts print SIMULATED and never send; the unfunded Base probe fails honestly.
7. Unit tests, lint and typecheck pass for the touched web package.
