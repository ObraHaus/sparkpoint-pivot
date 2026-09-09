# Quickstart — validating 029

## 1. CI gates (must pass before the PR)

```bash
cd services/agent
uv run python -m pytest -q            # incl. new guard_text / advice-boundary / fallback tests
uv run python -m ruff check .
uv run python -m mypy src/sparkpoint_agent
cd ../../apps/web
node --experimental-strip-types --test "src/**/*.test.ts"
npx tsc --noEmit -p tsconfig.test.json && npx tsc --noEmit && npx eslint src --max-warnings 0
```

## 2. Live verification — the SAME battery as the Aug-3 baseline

Re-run unchanged so results are directly comparable:

```bash
cd <scratch>/chat-regression && node harness.mjs      # 20 prompts, screenshots, header capture
cd <scratch> && node knowledge-quiz.mjs               # 14 knowledge questions, paced
```

**Pass criteria (mapped to the spec's success criteria):**

| # | Check | Baseline (Aug 3) |
|---|---|---|
| SC-001 | `x-chain-id` repaired count is **0/N**; no internal validation text in any transcript | 7/7 NaN; error text shown as Sparky's reply |
| SC-002 | Zero canned `_GENERAL_HELP` answers; failures show the honest error + retry | 3/20 silent canned |
| SC-003 | wallet / fees / APY / automation answers address the question | all four wrong-shaped |
| SC-004 | life-savings + 2 variants → boundary, no ranked cards | cards, no boundary |
| SC-005 | test funds / capabilities+memory / SRK / premium / recent changes answered | 4 of 5 failed or denied |
| SC-006 | no topic slugs, no "reference notes"-style phrasing anywhere | slugs + leak observed |
| SC-007 | refresh keeps the conversation; no duplicated progress rows | empty chat; steps duplicated |
| SC-008 | full CI green; policy verdict byte-identical for an identical proposal | — |

**Important**: run the battery with the harness's in-page header repair REMOVED (or assert its
counter is 0) — the point of SC-001 is that the repair is no longer needed.

**What the first verification run actually caught (Aug 3, post-deploy).** Recording it here because
it is the argument for running the battery at all, rather than trusting a green suite:

1. **The fix's own fallback was wrong.** `DEFAULT_CHAIN_ID` was the hardcoded `8453` (Base
   mainnet) — a chain `CHAIN_META` marks `offersVault: false` / `switchable: false`, pending the
   audit. While the `NaN` bug was live that fallback never executed (`??` skipped straight past
   it), so the wrong constant was invisible and every unit test passed. The moment the guard
   worked, every read asserted Base mainnet and the agent 503'd `/chat`, `/portfolio` and
   `/notifications`. Proven rather than inferred: `X-Chain-Id: 8453` → 503 "The vault RPC is
   unreachable"; `84532` → 200. **Generalises: repairing a guard ACTIVATES a fallback that was
   previously dead code — audit the fallback value in the same change.**
2. **The live-APY route could only ever decline.** The chat context provider never passed
   `gross_bps`, so `market.gross_apy_bps` was permanently `None` and FR-006 always took its
   honest-unavailable branch — while `/recommendations`, assembled from the same helpers, quoted
   0.44% at the same moment.

Neither was reachable from a unit test: the first needs a real deployment's chain to be wrong, the
second needs two endpoints compared against each other on the same wallet.

**Ops step the spec assumed away**: `knowledge_seed` is NOT ingested at boot (unlike
`content_seed`). After deploying a corpus change, run `POST /admin/knowledge/reingest` or
`python -m sparkpoint_agent.knowledge.ingest_cli`, or the assistant keeps answering from the old
corpus with no error anywhere. 029 took it from 6 sources / 25 chunks to 9 / 44. Now in
`DEPLOYMENT.md`.

## 3. Deploy notes (coordinator)

- No migration. No new env.
- Deploy **agent + web**. The three new knowledge documents ship in the agent image and are
  ingested at boot; confirm with `GET /admin/knowledge/status` → `source_count: 9` (was 6).
- Per the standing rule, watch both apps for ~3 minutes post-deploy and restart on `exited`.
