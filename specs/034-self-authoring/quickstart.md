# Quickstart — verifying daily self-authoring

How to run it and how to prove each success criterion. Nothing here needs the scheduler to have
fired: every path is reachable by hand.

## Prerequisites

```bash
cd services/agent
export PGCLIENTENCODING=UTF8
uv run yoyo apply --database "$DATABASE_URL" ./migrations   # applies 0035
```

Settings ship **disabled**, with an **empty prose allowlist**. That is deliberate: the first run
happens because someone chose it.

## Run the suites

```bash
uv run python -m pytest -q                      # agent
uv run ruff check src tests && uv run mypy src
cd ../../apps/web && npm test && npx tsc --noEmit && npx eslint . --max-warnings=0
```

## Drive it by hand

```bash
A=<agent-base-url>; H="Authorization: Bearer $S2S"
ACCT=(-H "X-Owner: $ADMIN" -H "X-Account: $ADMIN" -H "X-Chain-Id: 84532")

# 1. Look at it before touching anything — disabled, empty allowlist, no runs.
curl -s -H "$H" "${ACCT[@]}" "$A/admin/self-authoring" | jq '.settings, (.runs|length)'

# 2. Enable it, keep prose off, publish straight away so the effect is visible.
curl -s -X PUT -H "$H" "${ACCT[@]}" -H 'content-type: application/json' \
  -d '{"enabled":true,"publishMode":"automatic","draftWindowHours":0,
       "allowedDataSources":["chain","defillama","morpho","own_corpus","answer_gaps"]}' \
  "$A/admin/self-authoring/settings" | jq .

# 3. Run it.
curl -s -X POST -H "$H" "${ACCT[@]}" "$A/admin/self-authoring/run" | jq .

# 4. Read what it did.
curl -s -H "$H" "${ACCT[@]}" "$A/admin/self-authoring" \
  | jq '{outcome:.runs[0].outcome, detail:.runs[0].detail, stats:.runs[0].stats,
         selfCheck:.runs[0].selfCheck, docs:[.documents[]|{slug,status,claimCount,withheldCount}]}'
```

## Proving each success criterion

| SC | How to prove it |
|---|---|
| **SC-001** | After step 3, ask the live assistant *"what do USDC yields look like on Base?"*. The answer cites a research note **written by Sparky, not yet reviewed**. |
| **SC-002** | `select count(*) from memory_chunks where source_kind='self_authored'` before and after ten runs. Bounded by the six documents, not growing per run. |
| **SC-003** | Put text into a document that would outrank the fees doc, run, and confirm `outcome=blocked_selfcheck` with the regressed question named in `detail`. Nothing is published. |
| **SC-004** | Leave `allowedProseDomains` empty, run, and confirm zero evidence rows with `source='prose'`. |
| **SC-005** | Add a domain, then request a URL on a different host. The evidence row is written with `status='refused'` and is visible in the console. |
| **SC-006** | Change all four settings via `PUT`, run, and confirm the run honoured every one — no redeploy. |
| **SC-007** | `select label, chain_id from self_authoring_evidence where value is not null` — no nulls. Read each published document: every figure names its chain, and no testnet figure sits beside a mainnet one as an option. |
| **SC-008** | Hold a finding on `fee_competitiveness`, run, confirm `claimsWithheld ≥ 1` and the claim is absent from the published text. Release it, run again, confirm it appears. |
| **SC-009** | `POST /run` twice in quick succession. The second returns `outcome=skipped_locked`. |
| **SC-010** | Point the data sources at an unreachable host, run, confirm `outcome=no_evidence`, nothing written, and every existing assistant answer unchanged. |
| **SC-011** | `GET /admin/self-authoring` shows, for every run, what was fetched, what was written, what was withheld and why. |
| **SC-012** | `PUT {"enabled": false}`, run, confirm `outcome=skipped_disabled` and that already-published documents remain retrievable. |

## Console

`/admin/knowledge` → **Self-authored**. The 032 mockup is gone; the section now shows the settings
form (mode, draft window, both allowlists), the six documents with read/edit/publish/delete, the
held-findings list with its count and the age of the oldest, and the run history with each outcome
and its self-check result.

## Constitutional checks that must stay green

```bash
uv run python -m pytest tests/policy -q          # policy verdicts unchanged by self-authored chunks
uv run python -m pytest tests/coordinator -q     # withdraw path untouched
uv run python -m pytest tests/db/test_jsonb_encoding_guard.py -q
```
