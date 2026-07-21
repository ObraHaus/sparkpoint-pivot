# Implementation Plan: Universal Vaults

**Branch**: `010-universal-vaults` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-universal-vaults/spec.md`

## Summary

Make the app **universal / multi-vault for VISIBILITY and ADVICE only**. Today the recommender is
yield-blind (`_build_chain_context` sets `MarketData(gross_apy_bps=None, projected_apy_bps=None)`) and the
whole app reads exactly one hardwired SparkPoint vault. 010 (a) wires a keyless, **fail-open** market-data
feed — Morpho GraphQL primary, DeFiLlama / on-chain fallback — into that `MarketData` so the AI can rank
the SparkPoint Aave vault against external Morpho/QuickNode-Earn vaults on real net APY/TVL; (b) adds a
per-chain **vault registry** + a **generic ERC-4626 reader** (splitting the agent `vault_reader`
`_REQUIRED_METHODS` into a generic-4626 core vs SparkPoint-only extras; adding `resolveErc4626()` +
`useVaults()` on web) so adding a display vault is one registry row; (c) adds a **read-only**
`/admin/vaults` page + N-vault portfolio display; (d) gives chat **advisory parity** with citations.

Everything is **advisory + read-only**. No external protocol enters the policy `Protocol`/`Asset` enums,
the candidate/allowlist set, or any `(target,selector)` permission; no agent/vault **execution path** into
a non-whitelisted protocol is created; the launch vault and its custody semantics are untouched. External
figures are labeled "estimated / external / not a SparkPoint vault" and fail open to "unavailable". This is
the **read/advisory half**; the companion feature **[011 — Wrapper Vault Factory](../011-wrapper-vault-factory/)**
is the execute/manage half (SparkPoint-owned wrapper vaults + `/admin/vaults` *management* actions), and it
reads this feature's registry + generic reader.

Technical approach (from [research.md](./research.md)): a new `data/market_data.py` async feed with a
source-priority chain and a per-turn cache; per-candidate `MarketData` population in
`api/recommendations.py` / `coordinator/dag.py` / `agents/recommender.py`; a `vaults[]` list on the shared
`AddressBook` + agent config mirroring 007's `swapFeeRecipient` address-book pattern; a generic-4626 reader
seam in `chain/vault_reader.py` + web `resolveErc4626()`/`useVaults()`; a read-only `/admin/vaults` page and
an N-vault `derive.ts`. No new on-chain contract; no change to the vault, AA stack, session keys, or policy
allowlist.

## Technical Context

**Language/Version**: Python 3.12 for `services/agent` (FastAPI); TypeScript 5 (Next.js 15 App Router,
React 19) for `apps/web` and `packages/shared`; Solidity (Foundry) **unaffected** (no contract touched).

**Primary Dependencies**: `httpx` (async Morpho GraphQL + DeFiLlama calls) already in the agent; `web3.py` /
existing `chain/` RPC plumbing for on-chain fallback reads; viem 2 + wagmi 2 +
`@tanstack/react-query` on web for `resolveErc4626()`/`useVaults()`; `@sparkpoint/shared` (per-chain
address book). **No new runtime dependency expected** — Morpho GraphQL is a keyless HTTP endpoint.

**Storage**: none server-side beyond an in-process, time-boxed feed cache. No DB migration. The registry is
static config (agent config + shared `AddressBook`), not a table.

**Testing**: `pytest` for the agent feed (source-priority, fail-open, sanity-bounds, cache), the generic vs
SparkPoint reader split, and per-candidate `MarketData` wiring; `node:test`/Vitest for web
`resolveErc4626()`/`useVaults()`/`derive.ts` N-vault; Playwright e2e for `/admin/vaults` read-only render
(`domcontentloaded` + long hydration budget per the CPU-starved-box memory).

**Target Platform**: Web (desktop + mobile) + the Python agent service, on the same alpha Coolify
dev/staging deployment.

**Project Type**: Web application (Next.js frontend + Python agent service + shared TS package).

**Performance Goals**: the market feed is time-boxed (a few hundred ms budget) and cached per turn so a
slow/unreachable source degrades to "unavailable" without blocking a RECOMMEND turn; respect Morpho
GraphQL's ~750 req/min, no-SLA limit via caching + a single batched query per turn.

**Constraints**: fail-open honesty (external APY is "unavailable", never `0` or fabricated); advisory-only
(the feed never changes the candidate set or signability); read-only (no write path, no `/admin/vaults`
management control — that is 011); the policy `Protocol`/`Asset` enums + `enums.ts` TS mirror stay
byte-identical (CI parity T098); `SparkPointVault.sol` untouched; mainnet-only feed vs testnet deploy shown
as separate contexts.

**Scale/Scope**: 3 networks (8453, 84532, 46630); registry seeded with the 1 SparkPoint vault + ≥1 external
Morpho vault, extensible to N rows; one market feed with 2 fallback tiers; four read surfaces (recommender
context, `/admin/vaults`, portfolio display, chat) sharing one registry + one feed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.3.0.

| Principle | Assessment |
|---|---|
| **I. Non-Custodial by Construction (N1–N5, NON-NEGOTIABLE)** | **PASS.** 010 is read-only + advisory. It moves no funds, adds no execution path, and does not touch the vault, its withdraw/escape-hatch, session keys, or the guardian/timelock. No custody semantics change (N1–N5). |
| **II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)** | **PASS.** The advisory market data feeds **ranking/narration only**. The deterministic policy engine, the code-fixed candidate whitelist, the `Asset` enum, and the `(target,selector)` permissions are **UNCHANGED**. Morpho/QuickNode Earn is never policy-cleared or signable; the model's information set widens, its disposition authority does not (FR-020). |
| **III. Provable, Not Promised** | **PASS.** External figures are live + labeled "estimated / external", net of fees where the source provides it (else "gross (fee unknown)"), cited with recency, and fail open to "unavailable" — never fabricated, never `0`. The LAUNCH VAULT's own yield-from-Aave claim is untouched and kept clearly separate (external data is labeled NOT the SparkPoint vault). No return projections. |
| **IV. Security & Bounded Blast Radius** | **PASS with a recorded scope note (below).** No new custodial contract, no execution path. Guardrail IV.5's whitelist ("only Aave v3 + Aerodrome … impossible by construction") is **UNTOUCHED** — Morpho is not added to the policy allowlist. Advisory **information about** a protocol is not **interaction with** it. See Complexity Tracking. |
| **V. Conservative, Transparent Launch** | **PASS.** The single Aave launch vault + its fee model are untouched; **no new strategy is added "under the banner of the launch vault."** External vaults are shown as external **market context**, not SparkPoint vaults/strategies, with explicit badges. |
| **VI. Spec-Driven Development (NON-NEGOTIABLE)** | **PASS.** This plan follows spec → plan → tasks; no code lands before tasks exist; artifacts trace to the spec and to the companion 011. |
| **VII. Simplicity & YAGNI** | **PASS.** Extends the existing reader/recommender rather than adding an execution layer or a vault-management service; no speculative generality; the multi-vault surface is read-only display + advisory ranking, nothing more. |

**Recorded scope note (Guardrail IV.5 — whitelisted protocols).** The constitution's "only Aave v3 and
Aerodrome, impossible by construction" is a bound on **EXECUTION with custodied funds** — what the
deterministic policy engine and the vault can *reach*. 010 adds **ZERO** execution path into any
non-whitelisted protocol: it widens the AI's **information set** (what it can *see* and *talk about*), not
its **disposition** (what it can *sign* or *route funds through*). The registry `protocol` field is a
display/data attribute, deliberately separate from the policy `Protocol` enum, which — with its `enums.ts`
TS mirror (CI parity T098) — stays byte-identical. External Morpho/QuickNode-Earn figures are labeled
"estimated / external / not a SparkPoint vault", fail open to "unavailable", and are never emitted as a
candidate, `ProposedAction`, or signable item. This mirrors 007's precedent (007 broadened an
already-outside-policy user-signed surface's token set; 010 broadens the read-only advisory information set)
and is analogous to Principle II's own grant that the model MAY "analyze / rank / propose". This is
operator-directed (2026-07-21), recorded here for governance visibility; it does not weaken N1–N5,
Principle II, the whitelist, or the kill-switch, so **no re-ratification is required**. An explicit
functional requirement — **FR-020** (mirroring 007's FR-024) — forbids 010 from widening the policy
allowlist / `Asset` enum / `(target,selector)` permissions or creating any execution path into a
non-whitelisted protocol. The **execution/manage half is deferred to companion feature 011**, which will
run its own Constitution Check for any custody-touching surface it introduces.

**Result: GATE PASS** — proceed to Phase 0. No unresolved NON-NEGOTIABLE violations; advisory + read-only
keeps the gate open.

## Project Structure

### Documentation (this feature)

```text
specs/010-universal-vaults/
├── plan.md              # This file
├── spec.md              # WHAT/WHY (already written)
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — entities & shapes (registry row, MarketData, VaultReadout)
├── quickstart.md        # Phase 1 — how to run/verify locally
├── contracts/           # Phase 1 — internal interface contracts (feed shape, registry, reader seam)
│   └── vault-interfaces.md
└── tasks.md             # Phase 2 — /speckit-tasks output (task list)
```

### Source Code (repository root)

```text
services/agent/src/sparkpoint_agent/
├── data/
│   └── market_data.py            # NEW — keyless fail-open feed: Morpho GraphQL primary +
│                                 #        DeFiLlama / on-chain fallback; time-boxed + per-turn cache;
│                                 #        returns MarketQuote {apy gross/net, tvl, source, as_of, available}
├── api/recommendations.py        # _build_chain_context: populate MarketData per candidate from the feed
│                                 #   (today MarketData(gross_apy_bps=None, projected_apy_bps=None))
├── coordinator/dag.py            # MarketData dataclass: add net_apy / tvl / source / as_of / available;
│                                 #   thread per-candidate market context (advisory only, no policy change)
├── agents/recommender.py         # rank/narrate over real MarketData; candidate SET stays code-fixed +
│                                 #   whitelisted (build_action unchanged); external figures labeled
├── agents/strategy_recommender.py# advisory comparison narration references external vaults w/ citations
├── chain/vault_reader.py         # split _REQUIRED_METHODS → GENERIC_4626_METHODS (core) vs
│                                 #   SPARKPOINT_EXTRA_METHODS; add a generic reader path selected by
│                                 #   registry abiKind; SparkPoint vault keeps the full reader (no regress)
├── chain/abi/                    # add a minimal generic ERC-4626 ABI (core methods) alongside the
│                                 #   existing fixed SparkPointVault ABI
└── config.py                     # add vaults[] registry (per-chain rows) alongside the single
                                  #   SPARKPOINT_VAULT_ADDRESS / CHAIN_ID / RPC (which stay authoritative
                                  #   for the launch vault)

packages/shared/src/addresses/
├── types.ts                      # add readonly vaults?: VaultRegistryEntry[] to AddressBook — a PLAIN
│                                 #   data field, NOT a policy TargetRef (mirrors 007's swapFeeRecipient);
│                                 #   VaultRegistryEntry {chainId,address,protocol,abiKind,asset,
│                                 #   assetDecimals,verified,label,apySource}
├── base.ts                       # seed the SparkPoint vault row + ≥1 external Base-mainnet Morpho vault
├── baseSepolia.ts                # SparkPoint launch-vault row (apySource: onchain; external = unavailable)
└── robinhoodTestnet.ts           # SparkPoint context only (no external feed on 46630)
packages/shared/src/policy/enums.ts# UNCHANGED — Protocol/Asset enums byte-identical (CI parity T098);
                                  #   the registry `protocol` field is display-only, NOT this enum

apps/web/src/lib/chain/
├── resolveErc4626.ts             # NEW — generic on-chain 4626 read (asset/decimals/totalAssets/convert*)
├── useVaults.ts                  # NEW — list + per-vault live read driven off AddressBook.vaults[]
├── useVault.ts                   # UNCHANGED for the SparkPoint vault (single vaultAddressFor + fixed
│                                 #   sparkPointVaultAbi); useVaults() composes it for abiKind:sparkpoint
└── abis.ts                       # add a generic erc4626Abi (core) beside the fixed sparkPointVaultAbi

apps/web/src/lib/portfolio/
└── derive.ts                     # extend the closed 'vault' | 'idle' union to represent N vaults for
                                  #   DISPLAY; external vaults marked external (never a SparkPoint holding)

apps/web/src/app/admin/
└── vaults/page.tsx               # NEW — READ-ONLY list of all registered vaults w/ live TVL/APY/state +
                                  #   source/verified badges; NO management control (management = 011).
                                  #   Mounted via AdminShell like killswitch/tvl/revenue pages.

Living docs: CHANGELOG.md · DEVELOPMENT.md (market-feed env/config, registry schema, feed cache TTL,
Morpho GraphQL endpoint + fallback order) · services/agent/content_seed/whats-new.json (client-facing
per-phase entries) · in-app changelog (Admin → Updates row per user-visible phase)
```

**Structure Decision**: Web-application layout (Next.js frontend + Python agent + shared TS package). 010 is
concentrated in the agent's read/recommend path (`data/market_data.py`, `api/recommendations.py`,
`coordinator/dag.py`, `chain/vault_reader.py`) and a thin, additive web/shared seam (registry field,
`resolveErc4626`/`useVaults`, `/admin/vaults`, N-vault `derive.ts`). No new top-level project, no new
contract, no policy-package change.

## Phased design (maps to spec user stories)

Each phase is independently shippable to `develop` and honest at its own boundary. Every phase is
read-only / advisory; none adds a write or execution path.

- **Phase 1 → US1 (MVP): the AI can see live vault yields.** Add `data/market_data.py` (Morpho GraphQL
  primary → DeFiLlama → on-chain fallback; time-boxed + per-turn cache; fail-open to "unavailable"). Extend
  the `MarketData` dataclass (`coordinator/dag.py`) and populate it per candidate in
  `api/recommendations.py` `_build_chain_context`. `agents/recommender.py` ranks/narrates over the real
  figures with "estimated / external" labels; the candidate SET + policy stamps are byte-identical to
  today. **Checkpoint**: a mainnet-config RECOMMEND turn cites real net APY/TVL for the SparkPoint vault +
  ≥1 external Morpho vault; a killed feed degrades to "unavailable" with an unchanged candidate set.

- **Phase 2 → US2: universal registry + generic ERC-4626 reader.** Add `vaults[]` to the shared
  `AddressBook` (`types.ts` + per-chain seeds) and the agent `config.py`, mirroring 007's `swapFeeRecipient`
  address-book pattern. Split `chain/vault_reader.py` `_REQUIRED_METHODS` into `GENERIC_4626_METHODS` vs
  `SPARKPOINT_EXTRA_METHODS`; select the reader by registry `abiKind`. Add web `resolveErc4626.ts` +
  `useVaults.ts` and a generic `erc4626Abi`. **Checkpoint**: adding one registry row surfaces a new external
  vault to both agent + web reads with no other code change; the SparkPoint vault still reads its full
  method set (no regression); this registry + reader is the seam **011's wrappers are read through**.

- **Phase 3 → US3: read-only multi-vault visibility.** Add a **read-only** `/admin/vaults/page.tsx` (via
  AdminShell) listing every registered vault with live TVL/APY/state + source/verified badges and zero
  management controls. Extend `lib/portfolio/derive.ts` to represent N vaults for display without
  mislabeling an external vault as a SparkPoint position. **Checkpoint**: `/admin/vaults` lists SparkPoint +
  external vaults read-only; the existing `killswitch` page is unchanged; **this is the page 011's manage
  half attaches its controls to.**

- **Phase 4 → US4: chat advisory parity.** `agents/strategy_recommender.py` (+ chat narration) references +
  compares external vaults with source + recency citations, framed as "external / not a SparkPoint vault /
  not a signable action". No external vault becomes a candidate/`ProposedAction`. **Checkpoint**: chat can
  compare SparkPoint vs external with citations; 0 external vaults are ever emitted as signable.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| A new market-data feed (`data/market_data.py`) with a 2-tier fallback | The recommender is yield-blind today (`MarketData(...=None)`); "the AI can see vault yields" is impossible without a real APY/TVL source, and Morpho's mainnet-only, no-SLA API must not become a hard dependency | A single-source feed would make the whole recommender fail whenever Morpho's keyless API is down/rate-limited; hardcoding APYs would violate Constitution III (fabricated, not verifiable) |
| Splitting `_REQUIRED_METHODS` into generic-4626 core vs SparkPoint extras | External vaults expose only the standard ERC-4626 surface, not `performanceFeeBps`/`highWaterMark`/`feeRecipient`; the current single fixed reader would fail-closed on every external vault | Keeping the one fixed SparkPoint reader means no external vault can ever be read; adding a second bespoke reader per protocol violates "registry-only" + Principle VII |
| A per-chain `vaults[]` registry on the shared `AddressBook` (new data field) | "Adding a future vault is easy (registry-only)" requires a declarative list both agent + web read; it mirrors 007's `swapFeeRecipient` plain-field precedent | A per-vault code change (new reader/ABI/hook) each time defeats the brief; putting vaults in the policy allowlist would violate Guardrail IV.5 + FR-020 (it must stay a display/data field, NOT a policy `TargetRef`) |
| Advisory external-vault visibility inside a whitelist-bounded product (Guardrail IV.5 scope note) | Operator-directed; the brief needs the AI to see + suggest better yield; advisory information is not execution and the whitelist binds execution | Refusing to show any non-whitelisted vault keeps the AI yield-blind and fails the feature's purpose; the guardrail is fully preserved where it actually binds (the policy engine + vault execution path), and 011 handles any real execution under its own gate |
