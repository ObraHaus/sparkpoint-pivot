# Spec 079 — Rhea cross-chain (071 Phase C) review + gated live commit

**Status:** implemented slice (coding done; funded acceptance blocked — see `STATUS.md` in the job
folder) · **Branch:** `feat/079-rhea-xchain-mca` · **Worktree:** `sparkpoint-pivot-079`

## What this IS

This is **feature 071's cross-chain rail**: an EVM origin (Base/Ethereum USDC) reaches Rhea (Burrow)
on NEAR through NEAR Intents **1Click** plus Rhea's **Multichain Account (MCA)** business message
(`customRecipientMsg`). The first deposit registers the MCA (`BurrowRegisterAndSupply`) and later
deposits supply (`BurrowSupply`).

It is **not** 078. **078 is the same-chain NEAR → Burrow rail** (a connected NEAR wallet signs
`storage_deposit` / `ft_transfer_call` / `execute` directly). 078 is a separate branch and worktree.

## Non-custody / safety rules

- The agent never signs, submits or broadcasts, and holds no key.
- `dry=true` is the default and moves no funds.
- A live (`dry=false`) commit is allowed ONLY when **both** are true:
  `EARN_LIVE_RHEA_XCHAIN` is exactly `"true"` **and** the 1Click credential is present
  (`ONECLICK_API_KEY` non-empty). Only the boolean presence is surfaced; the value is never read
  into a log, response, exception or test fixture.
- A live commit returns an **UNSIGNED origin ERC-20 `transfer(address,uint256)` plan** for the
  user's own wallet. The wallet is the only signer. The agent never sends the plan.
- A first deposit needs one **off-chain EVM `personal_sign`** of
  `[{"EVM":"<addr without 0x>"}]` (no gas, no chain switch, no NEAR wallet). Without it the live
  route returns `requiresSignature=true` + `messageToSign` and does **not** call 1Click.
- Tags default OFF. No merge/deploy/flag-enable happens here.

## Requirements

- **R1 — Build on 071.** Reuse `earn/rhea.py` (`mca_for_wallet`, `create_mca_fee`,
  `supply_message`, `register_message`, `message_to_sign`, `custom_recipient_msg`) and the existing
  dry preview in `earn/service.py`. No new RPC/quote client.
- **R2 — Flags + server enforcement.** `EARN_LIVE_RHEA_XCHAIN` / 
  `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN`, default off. The agent returns `403 BETA_NOT_ENABLED` for a
  live commit when the gate is closed, so a browser cannot obtain a live quote from a disabled
  deployment. `GET /earn/rhea/xchain` exposes only flag/key-presence metadata.
- **R3 — Dual-access review.** `/vault` (the earn registry row) and Sparky's Rhea earn card both
  link to the same `/vault/rhea-xchain` review. The review shows origin chain/asset/amount, refund,
  MCA/recipient message, fees (one-time MCA fee, routing fee, net supplied) and, for a live commit,
  the deposit address + unsigned transfer plan. `dry=true` by default.
- **R4 — Unsigned origin plan.** Derive the origin ERC-20 from the 1Click `nep141:<chain>-0x…` id,
  encode `transfer(depositAddress, amountRaw)`, and return it as data (`unsigned: true`). A
  non-EVM origin is an honest `unsupported` plan, not an invented transfer.
- **R5 — Withdraw is honest.** No NEP-413-as-transaction and no invented custodian/relayer. The
  review lists the Rhea app link-out and the documented SDK paths (`relayer`,
  `nearMcaWithdrawTx`) as *documented but not implemented* here, with sources.
- **R6 — Status is read-only and owner-scoped.** `GET /earn/rhea/xchain/status` proxies 1Click
  status only for a deposit address this agent process prepared for the signed-in wallet.

## Non-goals

- No signing/submit/broadcast anywhere in the agent or tests; no fund movement.
- No persisted heavy DB row for Rhea deposits in this slice (in-process ownership only; noted as a
  hardening follow-up for multi-instance deploys).
- No Santa/other asset; no MCA creation transaction; no in-app withdraw transaction.
- No change to 077, 078 or the integration worktree.

## Acceptance (coding)

1. Flags default off; `/earn/rhea/xchain` reports `serverEnabled=false, keyPresent=false`.
2. A live commit with the flag off returns 403; with the flag on and no key returns 403.
3. With the flag on and a key, an existing-MCA live commit returns a live quote, a deposit address
   and an `unsigned: true` ERC-20 transfer plan; no signature is produced or sent.
4. A first-deposit live request without `signature` returns `requiresSignature=true` and makes no
   1Click call; with a signature it quotes and plans.
5. `/vault` + Sparky both link to the same review when the public flag is on.
6. Withdraw review has `nep413IsTransaction=false`, `custodian=null`, documented sources.
7. Agent tests, web unit tests and lint pass (the pre-existing
   `SparkLogo.tsx` PNG-declaration typecheck error excepted).

## Funded acceptance blockers (not coding)

- A funded EVM wallet on Base/Ethereum (USDC + gas) to exercise a real origin transfer.
- A live `ONECLICK_API_KEY` (value in the secret store only) and the Rhea/1Click credential wiring.
- An owner decision to enable the flags after a funded test.
- Sources: see `research.md` and `/home/hello/project/jobs/sparkpoint/1109-rhea-xchain/STATUS.md`.
