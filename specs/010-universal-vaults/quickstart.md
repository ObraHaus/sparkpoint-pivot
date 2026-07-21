# Quickstart: Universal Vaults (010)

**Created**: 2026-07-21

How to run and verify the feature locally + on the dev/staging (alpha) environment. 010 is **read-only +
advisory**: it wires a live yield feed into the recommender, a generic ERC-4626 reader + registry, and a
read-only `/admin/vaults` page. Nothing here signs, moves funds, or widens policy. The key thing to verify
is that every external figure is **honestly sourced and fail-open** — "unavailable" is a valid, correct
state, never a fabricated `0`.

> **Companion 011.** The manage/wrapper (signable) half lives in `011-wrapper-vault-factory`. If you are
> testing an action against an external vault, that is 011 — 010 exposes no such path.

## Prerequisites

- Node 20 (`.nvmrc`), **pnpm 9 (NOT 11 — see the pnpm-version trap)** for any dependency change.
- Python 3.12 + `uv` for the agent (`services/agent`).
- `pnpm install --frozen-lockfile` at the repo root.
- A wallet with test funds on Base Sepolia (84532) for the app reads (optional — reads work unconnected).
- Network egress to `https://api.morpho.org/graphql` (keyless) to exercise the primary feed. The feed is
  **mainnet-only**, so on testnet chains it correctly returns "unavailable" and the fallbacks/labels apply.

## Run

```bash
# Web (single + multi-vault reads, /admin/vaults):
pnpm --filter @sparkpoint/web dev

# Agent (recommender with the live market feed):
cd services/agent && uv run uvicorn sparkpoint_agent.app:app --reload
```

Env (all optional, keyless-by-default — documented in `DEVELOPMENT.md`):

```bash
MARKET_DATA_ENABLED=true                       # master switch; false ⇒ recommender stays yield-blind (old behavior)
MORPHO_GRAPHQL_URL=https://api.morpho.org/graphql
MARKET_DATA_TTL_SECONDS=120                     # freshness budget; older ⇒ stale=true (still labeled)
MARKET_DATA_TIMEOUT_MS=2500                     # per-provider timeout; on timeout ⇒ fail-open to fallback/unavailable
```

## Verify by user story

**US1 — the AI can see live vault yields (P1, MVP).** With `MARKET_DATA_ENABLED=true` on a Base **mainnet**
(8453) context, request a recommendation. Confirm the SparkPoint Aave vault now carries a real
`grossApyBps` (previously `null`) and external Morpho vaults appear in the prose/citations ranked by net APY
— each labeled **"estimated · external · not a SparkPoint vault"** with a `source` + `as_of`. Now force a
feed failure (`MORPHO_GRAPHQL_URL=http://127.0.0.1:1`): confirm the recommendation still returns, figures
degrade to "unavailable" (never `0`), and — the load-bearing check — **the set of signable candidates and
every policy verdict is unchanged** vs the populated run.

**US2 — universal registry + generic ERC-4626 reader (P2).** Add a `VaultMeta` row (an `abiKind:'erc4626'`
Morpho test vault) to `baseSepolia.ts` / `config.py`. Confirm: adding the vault required only that registry
row (no policy/enum change); the generic reader returns its `asset`/`decimals`/`totalAssets`; and a row
pointing at a non-vault address resolves to "unavailable" without crashing the others.

**US3 — read-only multi-vault visibility (P2).** Open `/admin/vaults`. Confirm it lists the SparkPoint vault
plus every registered external vault with live TVL/APY/state, the SparkPoint row is the ONLY one styled as a
SparkPoint vault, and every external row carries the external/estimated chrome. Confirm there are **no**
management controls (deposit/withdraw/pause/add) — management is 011. Kill the feed and confirm rows show
"unavailable", not `0`.

**US4 — chat advisory parity (P3).** In `/chat`, ask the assistant to compare the SparkPoint vault to a
higher-yield Morpho vault. Confirm it references the external vault **with citations** (source + as_of),
labels it external/estimated, and produces **no signable action** for it — there is no confirm card, no
policy gate invocation, no `proposedAction` targeting Morpho.

## Honest-state matrix (manual smoke)

| Case | Expected |
|---|---|
| Morpho GraphQL OK (mainnet) | real net APY/TVL, `source='morpho'`, labeled external/estimated |
| Morpho timeout/5xx | fail-open to DeFiLlama; then on-chain; else "unavailable" |
| Testnet chain (84532 / 46630) | Morpho mainnet-only ⇒ "unavailable" (SparkPoint vault still shown) |
| All providers fail | "unavailable" everywhere; recommender still ranks; **signable set unchanged** |
| Stale cache (> TTL) | `stale` surfaced; figure still labeled external/estimated |
| External vault reverts / no bytecode | that row "unavailable"; other rows unaffected (fail-open per row) |
| `decimals > 36` on an external vault | rejected → "unavailable", never a mis-scaled figure |
| `MARKET_DATA_ENABLED=false` | recommender exactly as today (yield-blind nulls), no external rows |
| Feed populated vs feed off | ORDER/PROSE differ; **signable candidates + policy verdicts identical** |
| Morpho in policy enum / candidate / TargetRef | MUST NOT appear — parity + no-widen tests fail if it does |

## Tests

```bash
# Web:
pnpm --filter @sparkpoint/web test resolveErc4626.test.ts useVaults.test.ts derive.test.ts
pnpm --filter @sparkpoint/web exec playwright test e2e/pw/admin-vaults.spec.ts   # domcontentloaded + long hydration budget

# Agent:
cd services/agent && uv run pytest tests/data/test_market_data.py tests/chain/test_vault_reader.py \
  tests/coordinator/test_advisory_only.py -q

# Policy non-widening (must stay green — Morpho never policy-cleared):
pnpm --filter @sparkpoint/shared test   # T098 Protocol/Asset/TargetRef parity
cd services/agent && uv run pytest tests/policy -q

# Green gate before any PR:
pnpm -w typecheck && pnpm -w lint && pnpm -w build
```

## Living docs to update before "done"

- `CHANGELOG.md` — dev bullet under `## [Unreleased]` for each phase (feed, registry/reader, admin page, chat).
- `services/agent/content_seed/whats-new.json` — a client-facing entry per user-visible phase (the AI now
  sees external yields; the read-only vaults view; chat can compare vaults). Stable `slug`s.
- `DEVELOPMENT.md` — document the `MARKET_DATA_*` / `MORPHO_GRAPHQL_URL` env vars and the `AddressBook.vaults[]`
  registry field (a plain, non-policy field — say so explicitly).
- Confirm no new agent seed dir was added; if one ever is, it needs an explicit `COPY` in
  `services/agent/Dockerfile` (none expected this feature).
