# Plan — 079 Rhea cross-chain (071 Phase C)

**Branch:** `feat/079-rhea-xchain-mca` · **Worktree:** `sparkpoint-pivot-079` (based on
`origin/develop`, which already contains 071 Phase A's dry preview, MCA lookup and
`customRecipientMsg` builders).

## Design

### Agent

1. **`earn/rhea_xchain.py` (new).**
   - `EARN_LIVE_RHEA_XCHAIN` / `ONECLICK_API_KEY` names; `xchain_live_enabled()` (exact "true"),
     `oneclick_key_present()` (boolean only), `live_gate()` and `gate_wire()`.
   - `origin_token_address()` derives the EVM ERC-20 from `nep141:<chain>-0x…omft.near`.
   - `erc20_transfer_calldata()` / `build_origin_transfer_plan()` produce an **unsigned**
     `transfer(address,uint256)` plan (or an honest `unsupported` plan for non-EVM origins).
   - `withdraw_review()` returns a guided review: the documented Rhea SDK paths first, the Rhea app
     link-out last, required wallet/chain + steps, and explicitly `nep413IsTransaction: false`,
     `custodian: null`, `signedBySparkPoint: false`.
2. **`earn/service.py`.**
   - `_rhea_preview` gains `dry=False` / `signature` support:
     - gate on flag + key before any live quote;
     - first deposit without `signature` returns the review with `requiresSignature=true` and makes
       **no** 1Click call;
     - with `signature` (off-chain `personal_sign`), quote `dry=false`, require a deposit address,
       build the unsigned plan and record ownership in-process.
   - New public methods: `rhea_xchain_gate`, `rhea_xchain_quote`, `rhea_xchain_withdraw_review`,
     `rhea_xchain_status`.
3. **`api/earn.py`.**
   - `GET /earn/rhea/xchain` (gate metadata), `POST /earn/rhea/xchain/quote` (`dry` default true),
     `GET /earn/rhea/xchain/withdraw`, `GET /earn/rhea/xchain/status`.
   - Live gate closed → `403 BETA_NOT_ENABLED`. No key value is ever serialized.
4. **Chat block + shared schema.** Additive optional `live`, `depositAddress`, `transferPlan`,
   `requiresSignature`; no 069/070/071 fixture changes when absent.

### Web

1. **`lib/earn/xchain.ts`.** Public/server flags (exact "true"), gate predicate, review href,
   review-line builder, plan offerability. Pure + unit-tested.
2. **`/vault/rhea-xchain`** server-gated route rendering `RheaXchainReview`:
   - fetch gate + withdraw review + Rhea USDC vault;
   - dry review (default); live commit when the gate allows;
   - first deposit: off-chain EVM `personal_sign`, then live quote;
   - review shows origin/refund/MCA message/fees; live shows deposit address + unsigned
     `transfer(...)` calldata; acknowledgement required before the wallet confirm;
   - the connected wallet signs/sends; the agent does not.
3. **Dual access.** `/vault`'s Rhea registry row and Sparky's Rhea earn card both link to the same
   review when `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN=true`.

### Verification

- Agent: `pytest tests/earn`, `ruff check src tests`.
- Web: `node --test` unit tests (including the new `xchain.test.ts`), `eslint`.
- Secret scan: scan the diff for key-shaped values; public production IDs stay full/auditable.
- No live quote (`dry=false`) is exercised in tests: every OneClick call is a mock and asserts the
  exact body.

## Rollout

Flags remain off. A funded owner test is required before enabling. No merge/deploy in this slice.
