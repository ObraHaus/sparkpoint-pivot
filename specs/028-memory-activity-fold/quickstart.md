# Quickstart — validating 028 (Sparky Memory v2)

## Prerequisites

- `services/agent`: `uv sync --frozen`; run tools as `uv run python -m <tool>` (module form —
  parallel-clone venv trap).
- Live validation needs: the test wallet key (`TEST_USER_PRIVATE_KEY`), alpha reachable,
  migration 0031 applied, agent redeployed at this feature's SHA.

## 1. Unit / CI gates (must all pass before the PR)

```bash
cd services/agent
uv run python -m pytest -q                      # incl. new test_activity / faucet_probe / cursor tests
uv run python -m ruff check .
uv run python -m mypy src/sparkpoint_agent      # strict, CI scope
cd ../../apps/web
pnpm test && pnpm typecheck:test && npx tsc --noEmit   # one-string change keeps these green
```

Key automated assertions to look for (SC-006/SC-007):
- `test_memory_boundary`: policy verdicts byte-identical with and without ACTIVITY lines.
- `test_chat`: every activity store forced to raise ⇒ turn streams normally, zero error blocks,
  one `user_memory_fold_failed` warning.
- `test_user_memory`: append+cursor atomic; clear keeps cursor; `UndefinedColumnError` ⇒ v1.
- `test_activity`: dedup by tx (flow+exec ⇒ one via-Sparky line); first-fold K=5; fold cap 10;
  deferred-pending carry; 120-char clamp; raw-UTF-8 (no `\u` escapes) in cursor writes.

## 2. Live validation on alpha (the SC-001…SC-005 matrix)

Order matters — do the manual action FIRST, chat SECOND.

| # | Action (as test wallet) | Then ask (fresh conversation each time) | Must see |
|---|---|---|---|
| 1 | Vault deposit via the VAULT PAGE (not chat) | "what have I done recently?" | the deposit, amount + date, labeled as your own action |
| 2 | Execute a Sparky-proposed deposit via the drawer | "did I act on any of your suggestions?" | that action, labeled via Sparky |
| 3 | Swap on /swap + claim the faucet on /premium | "what have I done recently?" | one swap line (~amount) + one faucet line |
| 4 | — (repeat question in 3 consecutive new conversations) | same question | no duplicated activity lines |
| 5 | Settings → Memory → Clear, then chat again | "what have I done recently?" | cleared activity does NOT return |

Also check Settings → Memory between steps: activity lines listed verbatim; disclosure copy
mentions platform activity.

## 3. Deploy notes (coordinator)

- Apply `0031_user_memory_activity_cursor` (with `PGCLIENTENCODING=UTF8`) — order-insensitive
  vs the agent redeploy (fallback proven by test), but apply-before-redeploy remains the
  house default. `yoyo apply --batch` applies everything pending — check what else is queued.
- No new env vars. The faucet probe uses the existing `BASE_SEPOLIA_RPC_URL`.
- Redeploy the agent; web redeploy only carries the disclosure string.
