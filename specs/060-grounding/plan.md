# Implementation Plan: 060 — Grounding

## Architecture

```
CoordinatorDag.run_chat
  ├─ deterministic guards (unsafe, unsupported swap, BRIDGE, WHATS_NEW, …)
  ├─ NEW: price guard  ──► coordinator/prices.py ──► data/prices.py (PriceService)
  ├─ curated / guidance routes ──► coordinator/staleness.py (as-of + 48h caveat)
  └─ planner → propose → policy gate → assemble (UNCHANGED; price never enters)
```

**Boundary:** prices and staleness text are display/prose only. They never reach
`ProposalContext`, `PolicyContext`, `policy.evaluate`, or a signable block.

## 1. Price service — `services/agent/src/sparkpoint_agent/data/prices.py` (new)

Public surface:

- `PriceQuote(symbol, usd, source, as_of, stale, approximate, note)`
- `PriceSnapshot(quotes: Mapping[str, PriceQuote], unavailable: frozenset[str])`
- `PriceService.get(symbols) -> PriceSnapshot`
- `get_price_service()` — process singleton (lru_cache) built from env, for wiring.

Sources / assets:

| Symbol | Primary id (CoinGecko) | Fallback pair (Coinbase) |
|---|---|---|
| ETH | ethereum | ETH-USD |
| BTC | bitcoin | BTC-USD |
| SOL | solana | SOL-USD |
| NEAR | near | NEAR-USD |
| USDC | usd-coin | USDC-USD |
| USDT | tether | USDT-USD |
| USDG | — (stable peg) | — |

- Env: `SPARKPOINT_PRICE_API_URL` (default `https://api.coingecko.com/api/v3`);
  `SPARKPOINT_PRICE_FALLBACK_URL` (default `https://api.coinbase.com/v2/prices`).
- TTL 60s, max stale 900s, timeout 2.0s, breaker threshold 3 failures / 60s cooldown.
- Cache by symbol; entry stores quote + monotonic fetch time.
- Read path: fresh → return; stale-but-within-max → return immediately + schedule one background
  refresh; missing/expired → bounded fetch; open breaker → cached stale if allowed, else
  unavailable.
- Stables: USDC/USDT reported at the feed value only if within ±2% of $1; otherwise the real value
  plus a depeg note. USDG is reported as ~$1 **only** while the USDC/USDT sanity check holds;
  otherwise USDG is unavailable rather than fabricated.
- Injectable `transport`, `monotonic`, `now` for tests. No client at import.

## 2. Price route — `services/agent/src/sparkpoint_agent/coordinator/prices.py` (new)

- `is_price_question(message)`, `requested_symbols(message)`, `is_srk_price_question(message)`.
- `price_answer(snapshot, symbols)` — deterministic markdown text:
  `ETH is about **$X** as of HH:MM UTC (source: …).` + not-advice + context-only note.
- `PRICE_UNAVAILABLE_ANSWER`, `SRK_PRICE_ANSWER`.
- Regex: price/quote/worth/value/trading-at shapes around a symbol alias; negative guard for
  portfolio/APY/vault/fee/swap/deposit/withdraw/balance/my/position/slippage/market-cap/supply.
- SRK matched explicitly first and answered from policy (no service call).

## 3. DAG hooks — `coordinator/dag.py` (small)

- Add optional `prices: PriceService | None = None` to `CoordinatorDag`.
- In `run_chat`, immediately after the unsupported-swap guard and before bridge/curated:
  - tool_step "Checking live prices" (running/done);
  - SRK → policy text;
  - otherwise `asyncio.wait_for(self.prices.get(symbols), PRICE_LOOKUP_TIMEOUT)` with a broad
    except → unavailable text;
  - emit a `TextBlock`; return.
- No LLM call, no action block.

## 4. Staleness — `coordinator/staleness.py` (new) + small call-site edits

- `STALE_AFTER = timedelta(hours=48)`.
- `as_of_stamp(as_of, now=None)` → `" (as of YYYY-MM-DD)"` or `""`.
- `staleness_caveat(as_of, now=None, subject="This figure")` → `""` when fresh/parseable, else
  `"This figure is N days old — rates move; check /vault for the live rate."`
- `format_as_of(...)` combined helper where useful.
- Use in `curated.py` (pick/list/rate), `guidance.py` (options/estimate/comparison and the
  no-duration estimate), and `_apy_answer` in `dag.py` (live reads get an "as of HH:MM UTC" stamp;
  no 48h caveat because they are read per request).
- Recommender: optional `as_of` on `ProposalContext`; template rationale appends
  `(as of YYYY-MM-DD)` when supplied; rank prompt includes `asOf=…`.
- Wire `MarketData.as_of` (optional) from the chat/recommendations providers if cheap; otherwise
  omit without changing behaviour.

## 5. Web — `apps/web/src/components/vault/CuratedBoard.tsx`

- Feature card: replace `net APY · as stored` with `net APY · as of <fmtWhen(...)>`, falling back to
  `as stored` when no timestamp exists. No data or behaviour change.

## 6. Knowledge seed (English)

- New `knowledge_seed/beta-questions.md`: Morpho vs Aave risk, APY mechanics, net APY, slippage +
  0.20% swap fee, NEAR Intents (November build), non-custody/signing, daily quota, mandates.
- Small factual additions/cross-links in `aave-v3-supply.md` and `usdc-yield-strategies.md` where
  they currently imply Aave-only.
- Facts pinned to the repo: 10% default performance fee; 0.20% swap fee; free 40 chat turns/day,
  premium 400; 48h staleness threshold; NEAR Intents planned for the November build; SRK has no USD
  price.
- Existing ingestion/content tests remain the gate.

## 7. Tests

- `tests/data/test_prices.py`: cache, SWR, timeout, fallback, breaker, depeg, USDG sanity.
- `tests/coordinator/test_price_route.py`: route answers without a model; SRK policy; portfolio/APY/
  command not hijacked; unavailable is honest.
- `tests/coordinator/test_staleness.py`: 48h boundary; caveat text; curated/guidance integration.
- Extend `tests/knowledge/test_knowledge_seed_content.py` for the new FAQ.
- Run the whole agent suite (seed ingestion included).

## 8. Changelogs

- `CHANGELOG.md` → `[Unreleased]` bullets (prices, as-of/staleness, corpus).
- `content_seed/whats-new.json` → one client-friendly entry with `published_at` earlier than now.

## Risks / mitigations

| Risk | Mitigation |
|---|---|
| Feed unreachable in production | 2s bound, cache + stale window, breaker, honest text. |
| Price route steals a real command | narrow regex + negative guard + command check. |
| Parallel branch 059 conflicts in `dag.py`/`sparky.py` | new modules; one small hook; do not edit Sparky. |
| Stale APY caveat noise | only after 48h; fresh answers unchanged. |
| Corpus contradiction | reuse existing facts; content tests for custody/return claims. |
