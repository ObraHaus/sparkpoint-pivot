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

## 3. Deploy notes (coordinator)

- No migration. No new env.
- Deploy **agent + web**. The three new knowledge documents ship in the agent image and are
  ingested at boot; confirm with `GET /admin/knowledge/status` → `source_count: 9` (was 6).
- Per the standing rule, watch both apps for ~3 minutes post-deploy and restart on `exited`.
