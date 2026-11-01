# Spec 069 — Morpho earn registry (data-driven vaults + 1Click Earn preview)

**Status:** backend implemented · frontend Phase B pending · **Owner:** build · **Branch:**
`feat/069-morpho-earn-registry` (stacked on `feat/068-oneclick-chat-swap`) ·
**Worktree:** `~/project/sparkpoint-pivot-069`

## Problem

The client asked whether **all** Morpho vaults can be supported. Today only one Morpho vault is
reachable through NEAR Intents 1Click Earn (a NEAR-issued ERC-4626 receipt), while a same-chain
wallet can deposit into any Morpho vault with plain ERC-4626, and Aurora Intents Connect can execute
a native Morpho deposit on six EVM chains. The answer must be **data-driven**: "support all Morpho
vaults" should be a config/snapshot question, not a code change.

## Requirements

- **R1 — Data-driven registry.** Morpho V1 (MetaMorpho) and V2 vaults are fetched from Morpho's
  GraphQL API, normalized, filtered and cached. Chains, filters, allow/deny lists, curated defaults
  and 1Click receipts live in `earn/earn.json` (override with `EARN_CONFIG_PATH`;
  `EARN_ENABLED=0` disables). No vault address is hard-coded in a request handler.
- **R2 — Snapshot, never a request-path API call.** The registry refreshes from a background task
  (mirroring `api/vault_apy_poller.py`), persists a JSON snapshot under the agent data dir, and
  ships `earn/snapshot.json` as the fallback when Morpho is unreachable. GET handlers read the
  in-memory/snapshot data only.
- **R3 — Honest rails.** Each vault reports which rails can actually reach it: `direct` (same-chain
  ERC-4626, native Morpho share), `oneclick_earn` (only a configured receipt whose `underlying_vault`
  matches; liveness from the last dry quote), `intents_connect` (only with the flag, an Aurora key
  and a configured supported asset; emits an approve+deposit step plan as data). A wrapper receipt is
  labelled as **not** the native share, and the keyless 0.25% fee is disclosed.
- **R4 — HTTP surface.** `GET /earn/vaults`, `GET /earn/vaults/{chain}/{address}` and
  `POST /earn/preview` (dry only) behind the same S2S auth/account/rate-limit deps as
  `api/crosschain.py`. No DB migration.
- **R5 — Chat route.** A deterministic parser before the planner answers "show/list/best Morpho
  vaults…" and "deposit/put/stake X USDC into/in Morpho [vault] [on chain]" with a `text` block plus
  the new `earn_vaults` / `earn_quote` ChatBlock. It only fires on an explicit Morpho mention or a
  configured vault name, so the existing vault/deposit flow and comparative turns are unchanged.
- **R6 — Scripts + tests.** `scripts/earn_registry_snapshot.py` fetches Morpho (≤6 requests) and
  writes the snapshot; `scripts/earn_dry_smoke.py` runs REAL dry 1Click quotes. Tests mock all HTTP:
  V1/V2 normalization, filters, fallback, rails gating, preview outcomes, router validation,
  parser positives/negatives and the DAG hooks. A few golden eval cases cover the chat route.
- **R7 — Spec-kit artifacts** in this directory. Web card and deposit/withdraw UI are Phase B.

## Non-goals

- No signing, custody or on-chain transaction from the agent.
- No live quote in Phase A (`dry=false` is rejected in `/earn/preview`).
- No live Aurora Intents Connect call (no key exists; the rail is data-only).
- No change to Defender config, CI secrets, model/billing config, or the 068 cross-chain path.
- No new npm/python dependency.

## Acceptance

1. `GET /earn/vaults` returns the filtered snapshot with per-vault `rails` and snapshot age; no
   Morpho call is made from the handler.
2. The registry loads `earn/snapshot.json` when the API fails and reports `source="shipped"`.
3. `/earn/preview` defaults to dry, rejects `dry=false`, and maps a dry 1Click receipt quote,
   no-liquidity (unavailable), and a same-chain direct hint without calling 1Click.
4. Chat: "Show Morpho vaults on Base" emits `[text, earn_vaults]`; "Deposit 100 USDC into Morpho
   Gauntlet USDC Prime" emits `[text, earn_quote]`; neither calls the LLM. "deposit 100 USDC into the
   vault" and "Compare Aave and Morpho, then deposit 500 USDC into the safer one" keep the planner.
5. Rails never claim a wrapper receipt is the native Morpho share; Intents Connect is unavailable
   with an honest reason unless flag + key + supported asset are all present.
6. Full agent `pytest`, `ruff check` and `mypy` pass (12 pre-existing vault_reader forge-artifact
   failures excepted).
