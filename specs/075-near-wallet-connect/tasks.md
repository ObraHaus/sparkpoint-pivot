# Tasks — 075 NEAR wallet connect (Meteor first)

## Core

- [x] T001 Pin `@hot-labs/near-connect@0.12.0` in `apps/web/package.json` and update
  `pnpm-lock.yaml` (`pnpm install --frozen-lockfile` must pass).
- [x] T002 `lib/near/network.ts` — env network/RPC parsing (mainnet default, invalid ⇒ mainnet).
- [x] T003 `lib/near/account.ts` — account-id validation + implicit-id truncation.
- [x] T004 `lib/near/adapter.ts` — narrow connect/disconnect/accountId/signMessage adapter,
  dynamic client-only import, Meteor first, test hook gated by build flag, no transaction surface.
- [x] T005 `lib/near/NearWalletProvider.tsx` — provider + `useNearWallet`; client-side claim only.
- [x] T006 `lib/near/recipient.ts` — cross-chain recipient precedence (manual → EVM/NEAR → none).
- [x] T007 `lib/near/rhea.ts` — Rhea account selection (connected → pasted → preview MCA).
- [x] T008 `lib/near/phaseC.ts` — Phase C flag, sign offer, NEP-413 request.

## UI

- [x] T009 `components/near/NearWalletControl.tsx` — connect/disconnect control, Meteor label,
  truncated id; mounted in the top bar and `/connect`.
- [x] T010 `components/near/NearWalletPortfolioLine.tsx` — account + honest "balances coming
  soon" note; mounted in the 072 chat card and `/portfolio` panel.
- [x] T011 Cross-chain card prefills a NEAR destination from the connected account (editable;
  EVM unchanged).
- [x] T012 Rhea card names the connected NEAR account and keeps the server-derived MCA recipient.
- [x] T013 Phase C sign button behind the off-by-default flag; signature shown as not submitted;
  deposit remains disabled.
- [x] T014 Mobile CSS: `.nearPill` hidden at the same breakpoint as `.walletPill`.

## Tests

- [x] T015 Unit tests: network, account, recipient, Rhea selection, Phase C gating.
- [x] T016 No-transaction test: a throwing wallet proves `signAndSendTransaction` /
  `signTransaction` are never called; source guard on NEAR modules/surfaces.
- [x] T017 `e2e/pw/near-wallet.spec.ts` + `near-wallet-mock.ts`: connect → id in wallet + portfolio
  → NEAR recipient prefill → Rhea sign-only → disconnect; mock throws on any transaction call.

## Docs / release

- [x] T018 `CHANGELOG.md` `[Unreleased]` entry.
- [x] T019 `services/agent/content_seed/whats-new.json` client-facing entry.
- [x] T020 `DEVELOPMENT.md` / `COOLIFY.md` env names (no values set).
- [x] T021 `.gitignore` key-file patterns (`.claude/near-wallet.txt`, `**/near-wallet*.txt`).
- [x] T022 Spec Kit artifacts (`spec.md`, `plan.md`, `research.md`, `tasks.md`, `quickstart.md`).

## Verification

- [x] T023 Full local CI replication (web, changelog, custody/knowledge/policy/vault gates, agent
  because `content_seed` changed) and the Playwright spec against a local production build.
