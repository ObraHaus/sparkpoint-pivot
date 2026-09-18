# Feature Specification: AI-curated vaults — Sparky discovers, ranks and recommends (Robinhood Chain)

**Feature Branch**: `feat/048-ai-curated-vaults` (to open off `develop`)

**Created**: 2026-09-18

**Status**: Specified — decisions locked by the operator (below). **Not implemented.**

**Input**: Operator brief 2026-09-18: incorporate existing vaults with Sparky AI — (1) Sparky finds
new vaults and adds them to `/vault`; (2) Sparky recommends the best vault daily; (3) a bot runs
daily to maintain the curated list and publish the best pick to the page and to chat; curated list
lives **off-chain** (no gas); contracts must support any vault with our **performance fee**; plus
wireframes, an admin panel, and the side quests.

## ⚠️ Blocking external dependency — verified, not assumed

**Morpho is not deployed on Robinhood Chain 4663.** Probed 2026-09-18 against Morpho's public API:
`chainId_in: [4663]` returns **0 vaults**, and 4663 is not a supported chain in their API. The
operator has **locked 4663** and **deferred Base mainnet** for this feature.

Consequences (recorded so the plan is honest):

- The curator bot, the curated store, the `/vault` surfaces, chat answers, and the admin panel can
  all be built and verified **now** — they will show the honest “no vaults on this chain yet” state.
- The **wrapper / performance-fee contract work (M1) is gated** on at least one live ERC-4626 vault
  on 4663 (Morpho or any equivalent source the discovery bot is configured for). Do not deploy a
  wrapper against nothing.
- Discovery is **chain-configured** (a single `CURATOR_CHAIN_ID`, default 4663) so re-pointing it
  later is configuration, not a rewrite.

## Locked decisions (operator, 2026-09-18)

| # | Decision | Value |
|---|---|---|
| D1 | Fee model | **Performance fee only** — a fee only on a user's gain over the high-water mark. A deposit, a withdrawal, or a position with no gain (including a loss) is **never** charged. No entry/exit fee. |
| D2 | Chain | **Robinhood Chain (4663). Locked.** Base mainnet **deferred**. |
| D3 | Cadence | **Daily** discovery + best-vault refresh (manual “Run now” always available). |
| D4 | Contract model | **Hybrid** — curated vaults get a SparkPoint **performance-fee wrapper** (reuse the existing feature-011 wrapper pattern; no new custody-critical Solidity unless review says otherwise); a curated vault without a wrapper remains depositable **directly** (no fee, disclosed). |
| D5 | `/vault` look | **A + C** — the curated board (hero “Sparky's pick”, table, provenance) with a chat entry point for “what's best?”. |

## Requirements

- **FR-001 (curation is off-chain).** The curated list, the daily best pick, and all metadata live in
  the agent's database. Adding, ranking, or removing a vault **must never require an on-chain
  transaction**. The chain only ever sees user-signed deposits/withdrawals.
- **FR-002 (discovery).** A bot runs **daily** and queries a chain-configured vault source. Each
  candidate is screened (withdrawable liquidity, TVL, asset allowlist, curator identity where the
  source provides it, age, anomaly checks) and scored; only screened vaults may enter the curated
  list. Every decision stores **why** (the score inputs at scan time).
- **FR-003 (best pick).** Each run publishes one recommended vault plus two alternates, with the
  reason and an as-of timestamp. The recommendation is visible on `/vault` and answerable in chat.
- **FR-004 (chat).** “What's the best vault?” / “where should I deposit?” answer from the same
  curated record and deep-link to `/vault`; the answer never invents a vault or a number.
- **FR-005 (fee).** Where a SparkPoint wrapper exists for a curated vault: a performance fee applies
  **only** to gains above the high-water mark, as share dilution to the configured recipient (the
  existing wrapper semantics). **No deposit fee, no withdrawal fee, no fee on loss or flat.**
  Direct-deposit vaults carry a prominent “no SparkPoint fee wrapper — deposit direct” disclosure.
- **FR-006 (universality).** The curated list is data: any supported vault can be added/removed by
  the bot or an admin without deploying or upgrading anything. Contract support follows the list via
  the wrapper factory (hybrid), never an on-chain allowlist that would need a transaction to change.
- **FR-007 (admin parity).** Every autonomous action has a manual equivalent in **Admin → Vaults**:
  review candidates, approve/deny, pin/unpin best, hide, edit metadata, add by address, “Run
  discovery now”, and an audit log. Admin edits are authoritative and are never overwritten by a
  scan. Auto-publish is a visible toggle; the default is **AI proposes, admin publishes**.
- **FR-008 (honesty).** If 4663 has no vaults, `/vault` says so plainly (the `/strategies` register),
  never an empty curated table pretending to be a market. All APY/TVL numbers are as-of a stored
  scan; no projections.
- **FR-009 (non-custody).** The bot holds no key that can move funds; deposits are user-signed; the
  wrapper (where present) is non-custodial per the existing vault invariants (withdraw always open).
- **FR-010 (disclosure).** Trust Center discloses the wrapper (when deployed), that curation is
  off-chain and AI-driven, and that a manual admin override exists.
- **FR-011 (cadence config).** Daily default, configurable per environment; a run that fails leaves
  the last good list and pick untouched (fail-open to the last record) and reports loudly.

## Non-goals

- Base mainnet (deferred by D2), Arbitrum bridging (still deferred).
- Entry/exit-fee routers, exact-output swaps, multi-chain aggregation.
- Creating our own Morpho vaults (we connect to existing ones; wrappers hold no strategy of ours).
- Any autonomous on-chain action by the bot.

## Test plan

- **Unit (agent):** scoring and screening rules (anomalies excluded, thresholds); best-pick selection
  determinism; curation-store upsert/prune; admin edit precedence over scans; a failed run leaves the
  last good record; “no vaults” state.
- **Unit (web):** curated board renders pick + table + provenance; deposit CTA routes to the right
  path (wrapper vs direct); chat answer uses the curated record; honest empty state.
- **Contract (when M1 unblocks):** wrapper performance-fee math (fee only on gain above HWM; zero on
  flat/loss; no deposit/withdraw fee); fork test over a real 4663 vault; non-custody invariants.
- **Chat e2e:** “what's the best vault?” returns the stored pick; a swap intent still builds the
  inline card (see 048 side quest tracking).
- **Ops:** daily run observability (last-run timestamp surfaced on `/vault`), Kuma monitor, admin
  audit.

## Side quests (operator, same brief — shipped separately)

1. Remove “Route via” from `/swap` for now.
2. Swap token dropdown: more default tokens than ETH/USDG/SPCX.
3. Chat swap: prefill the inline card's parameters from the AI intent so the user only confirms.
