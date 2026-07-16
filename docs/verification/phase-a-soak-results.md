# Phase A soak — per-turn results (reproducible)

Captured 2026-07-16 against the deployed develop stack (public web BFF → agent → LiteLLM
gateway `sparkpoint-chat` → OpenRouter). Reproduce with `scripts/e2e-soak.sh` (pass `WEB_URL`,
`AGENT_URL`, `S2S_TOKEN`). The high, variable latency is the OpenRouter **free tier** (the
primary `gemma-4-31b:free` is heavily 429'd, so the router falls back to `gemma-4-26b-a4b:free`).

## Chat — 20 turns via the BFF

| # | verdict | latency (ms) |
|---|---------|--------------|
| 0 | REAL | 11450 |
| 1 | REAL | 8839 |
| 2 | REAL | 11901 |
| 3 | REAL | 19885 |
| 4 | REAL | 23028 |
| 5 | REAL | 16491 |
| 6 | REAL | 9709 |
| 7 | REAL | 9660 |
| 8 | REAL | 28268 |
| 9 | REAL | 22654 |
| 10 | REAL | 11861 |
| 11 | REAL | 17644 |
| 12 | REAL | 8527 |
| 13 | REAL | 12256 |
| 14 | REAL | 7282 |
| 15 | REAL | 13924 |
| 16 | REAL | 13450 |
| 17 | REAL | 12559 |
| 18 | REAL | 7468 |
| 19 | REAL | 10670 |

**=> 20 / 20 REAL completions.** Latency min / median / max = **7.3 / 12.3 / 28.3 s**.

## Recommendations — real Obsidian citations

`POST /mandate` (conservative) → **v1**, then `GET /recommendations?limit=5`:

| # | recs | total citations |
|---|------|-----------------|
| 0 | 2 | 6 |
| 1 | 2 | 6 |

Each of the 2 policy-**approved** recs (`Liquidity Supply`, `Vault Deposit`, protocol `aave_v3`)
carried 3 relevant Obsidian citations — `obsidian://usdc-yield-strategies`,
`obsidian://risk-profiles`, `obsidian://aave-v3-supply`. (The soak monitor was stopped after
rec #1; the pattern is deterministic for a fixed mandate.)
