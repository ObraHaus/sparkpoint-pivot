# Feature Specification: Grounding — live prices, as-of APY, beta knowledge

**Feature Branch**: `feat/060-grounding` (off `main`; counterpart `feat/060-grounding-develop` off `develop`)

**Created**: 2026-10-27

**Input**: Beta observation — "What is the price of ETH today?" answered "I can't pull live price
data". Follow-up requirements: cached keyless USD prices with graceful degradation; deterministic
price route; explicit as-of/staleness on every APY figure; broader English grounding docs.

## Problem

Sparky is honest but not useful on three ordinary beta questions:

1. **Prices.** No price tier exists, so every price question falls to a prose prompt that forbids
   quoting prices.
2. **Stale APY.** Curated data carries `as_of`, but the stamp is inconsistent across routes and
   there is no staleness caveat. A weeks-old net APY looks identical to a fresh one.
3. **Coverage.** Common product questions (Morpho vs Aave, net APY, slippage + swap fee, NEAR
   Intents timing, non-custody/signing, daily quota, mandates) are not all answerable from the
   shipped corpus in one place.

## Requirements

### Price service (display-only)

- **FR-060-001** — Provide a USD price service for the assets SparkPoint shows: **ETH**, the chain
  stables **USDC / USDG / USDT** (reported at ~$1 with a depeg sanity check), and **BTC / SOL / NEAR**
  for context only.
- **FR-060-002** — Use a **free, keyless** primary source (CoinGecko `simple/price`) with a
  **secondary fallback** (Coinbase spot), a configurable base URL via env with a sane default, and
  **no API keys**.
- **FR-060-003** — Cache in memory with a **~60s TTL**, serve stale-while-revalidate up to **15
  minutes**, use a **hard timeout of ~2s**, and a **circuit breaker** (fail fast after repeated
  failures, cool down, then retry).
- **FR-060-004** — **Never block chat** on the feed. A lookup is bounded; on failure the answer says
  it could not fetch a live price and does not guess.
- **FR-060-005** — If the deployment cannot reach the internet, degrade gracefully: cached values
  may be served stale, otherwise the honest unavailable answer. No exception escapes to the stream.
- **FR-060-006** — **SRK keeps its no-price policy**: no oracle, no invented USD figure.

### Deterministic price route

- **FR-060-007** — Recognise price question shapes ("price of ETH", "how much is ETH", "ETH
  worth", "what's BTC trading at") and answer deterministically **before the model**, with the price,
  the source, an **"as of HH:MM UTC"** stamp, and a **"prices move; not advice"** note.
- **FR-060-008** — Do **not** hijack portfolio valuation, APY/rate, vault, fee, swap, or explicit
  financial commands. A funded command ("swap 100 USDC for ETH") still routes normally.
- **FR-060-009** — Context-only assets (BTC/SOL/NEAR) are labelled as context only, and
  non-tradable on the current network.

### APY as-of + staleness

- **FR-060-010** — Every APY figure Sparky states includes an **as-of date** across the curated
  route (pick, list, rate), yield guidance (options, estimate, comparison), and the live APY answer.
- **FR-060-011** — Data older than **48 hours** carries an explicit caveat of the form
  “this figure is N days old; check /vault for the live rate”. Fresh data is not burdened with it.
- **FR-060-012** — The recommender's injected-figure rationale carries the market as-of when one is
  supplied, and the rank prompt includes it so the model cannot strip it.
- **FR-060-013** — The public `/vault` board shows an as-of label on the feature card (small,
  display-only change).

### Knowledge grounding

- **FR-060-014** — Add/extend **English-only** seed docs so common beta questions are grounded:
  Morpho vs Aave risk (accurately reflecting the curated Morpho-based vaults and the SparkPoint Aave
  vault), how APY is computed and varies, net APY after fees, slippage and the 0.20% swap fee, what
  NEAR Intents is and that it is coming in the November build, non-custody and signing, the daily
  question quota, and mandates.
- **FR-060-015** — Do not invent numbers. Use figures already established in the repo
  (10% default performance fee, 0.20% swap fee, 40/400 free/premium chat turns, 48h staleness
  threshold where applicable, 5,000 SRK/24h faucet, November build for NEAR Intents).
- **FR-060-016** — Seed ingestion and content tests continue to pass.

### Delivery

- **FR-060-017** — Update both changelogs: repo `CHANGELOG.md` and the client-facing
  `content_seed/whats-new.json` (published_at not in the future).
- **FR-060-018** — Changes to shared files (`coordinator/dag.py`, `agents/sparky.py`,
  `agents/recommender.py`) are minimal hooks; new behaviour lives in new modules.

## Non-goals

- On-chain oracles, price-based valuation changes, portfolio P&L repricing.
- Trading/execution based on a price; any price in a signable block or policy input.
- Paid feeds, API keys, or authenticated providers.
- Pricing SRK.
- Cross-chain swaps / NEAR Intents implementation (they remain future work).
- Changing model/billing/LiteLLM configuration.

## Success criteria

- "What is the price of ETH today?" returns a price with source, UTC as-of, and a not-advice note —
  and does so with no model call.
- With the feed unreachable, the same question returns an honest unavailable answer, and chat still
  streams normally within the latency bound.
- "What is the price of SRK?" returns the no-price policy answer.
- "What's the current APY?" / "what's my portfolio worth?" / "swap 100 USDC for ETH" are not answered
  by the price route.
- A curated APY older than 48h renders an explicit staleness caveat; a fresh one does not.
- The new corpus document is ingested by the existing pipeline and answers the listed questions
  without contradicting non-custody, fee, or network facts.
