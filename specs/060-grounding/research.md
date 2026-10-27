# 060 — Grounding: live prices, APY as-of, and beta knowledge

**Status:** research complete (2026-10-27). Branch: `feat/060-grounding`.

## 1. The reported failure

On the beta, "What is the price of ETH today?" returned:

> I can't pull live price data …

That is correct about the current architecture, and it is the wrong product answer. Sparky has a
deterministic route for several question shapes whose correct answer is knowable (fees, vault APY,
withdraw, safety), but **prices have no route at all**. A price question falls through to the
planner and lands on `IntentKind.OTHER`, where the general `Sparky` prose prompt explicitly forbids
quoting a price ("you have no live figures in this turn"). The result is an honest refusal that
reads as a broken assistant.

## 2. How prices are used today

| Surface | Today | Notes |
|---|---|---|
| Portfolio (`/portfolio`, `api/portfolio.py`) | On-chain valuation only: the chain stable is $1 par, wrapper/underlying positions use share price. `priceSource = "onchain"`. | Never claims an oracle. Unknown values stay unknown. No USD price of ETH/BTC is used. |
| Vault (`/vault`) | APY + TVL from the vault/Morpho reads, no asset price. | Net APY is a rate, not a USD price. |
| Swaps | Quote/route math only. No USD reference price. | The 0.20% fee is a routing fee, not a price. |
| Knowledge corpus | `srk-and-premium.md` states SparkPoint quotes **no dollar price for SRK** (no oracle). | Keep this policy: SRK must not gain a price route. |

So there is no existing price service to reuse, and no existing place where a missing price silently
becomes a wrong number. Feature 060 adds a **new, display-only** price tier rather than changing
valuation.

## 3. Curated vault APY and its as-of fields

- The curated record stores `as_of` per scan/recommendation (`db/curated_vaults.py`, migration 0025).
- `api/curated_vaults.py` exposes `asOf` on the published pick and its alternates; the public board
  also carries `lastRunAt` / `lastRunOk`.
- `api/chat.py` maps the board row to `CuratedPick(as_of=…)`; the chat formatters
  (`coordinator/curated.py`) already print `as of YYYY-MM-DD` in some branches.
- `coordinator/guidance.py` prints as-of in options/estimates/comparison, again partly.
- The **recommender** uses live Aave market figures (`MarketData.gross_apy_bps` /
  `projected_apy_bps`) and never carries an explicit as-of, so a rationale can state an APY with no
  timestamp.
- The public `/vault` feature card labels the pick's APY "net APY · as stored" with no date, even
  though `lastScanAt` / `asOf` / `updatedAt` are present on the wire.

**Gap:** the as-of stamp is present in some sentences, absent in others, and there is no staleness
policy. A three-week-old net APY currently renders exactly like a fresh one.

## 4. Knowledge ingestion / RAG

- Seed files live in `services/agent/knowledge_seed/*.md` (Obsidian markdown: frontmatter, H1, H2
  sections, `[[wikilinks]]`).
- `knowledge/ingestion.py` parses → chunks → embeds → upserts into `memory_chunks`; chunk ids are
  deterministic UUID5s, re-ingest is idempotent and prunes stale chunks.
- `api/chat.py` grounds only prose branches (`LEARN`, `OTHER`) through `KnowledgeGrounder`; corpus
  passages never reach propose/build/policy.
- Existing seed docs cover Aave mechanics, ERC-4626, profit-only fee, risk profiles, SRK/premium,
  platform surfaces, and beta broker revenue. They do **not** directly answer: Morpho vs Aave risk,
  how net APY is computed, slippage + the 0.20% swap fee together, what NEAR Intents is and when it
  arrives, daily question limits, or mandates in one place. The facts exist across the repo
  (`specs/047-beta-fee-router`, `specs/048-ai-curated-morpho-vaults`, `specs/049-universal-vault-wrapper`,
  `migrations/0015_limits.sql`, `docs/design-handover/02-flows/01-onboarding.md`), so a new
  consolidated FAQ note can be written **without inventing numbers**.

## 5. Constraints discovered

- **Non-custody:** a price feed is display data. It must never touch `ProposalContext`,
  `PolicyContext`, caps, or a signable block. Text blocks only.
- **No keys / no paid APIs:** use keyless public endpoints (CoinGecko `simple/price`, Coinbase spot).
- **Deployment connectivity is not guaranteed:** a container may have no egress. The route must
  degrade honestly and must never delay chat beyond a hard bound.
- **SRK policy:** no USD price, by explicit product policy (no oracle).
- **Parallel branch 059** rewrites `coordinator/dag.py` and `agents/sparky.py` heavily. Changes there
  must be small hooks; the bulk goes in new modules.
- **Stablecoins:** USDC/USDG/USDT are shown at ~$1. A feed that reports $0.87 is a depeg signal, not
  a number to silently normalise away; the answer should say so.

## 6. Design implications

1. A dedicated `data/prices.py` service with TTL cache, stale-while-revalidate, hard timeout,
   secondary source, and a circuit breaker. Injectable transport/clock for tests.
2. A dedicated `coordinator/prices.py` route module: narrow regexes, symbol aliases, SRK policy
   answer, honest formatting, and an explicit "not advice" note.
3. One small hook in `run_chat` before the planner (so the model cannot mis-say a price) and one
   optional `prices` dependency on the DAG.
4. A pure `coordinator/staleness.py` used by curated, guidance, and the APY answer. Threshold 48h;
   older data gets "this figure is N days old; check /vault for the live rate".
5. Corpus expansion as a new English FAQ document plus small additions to existing docs, then run
   the existing ingestion/content tests.
