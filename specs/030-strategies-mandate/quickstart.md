# Quickstart — verifying 030

## 1. Local gates

```
cd services/agent && uv run python -m pytest -q && uv run python -m ruff check src tests && uv run python -m mypy src
cd apps/web && npm test && npx tsc --noEmit && npx tsc -p tsconfig.test.json --noEmit && npx eslint src --max-warnings=0
```

## 2. Migration

Apply `0033` to the develop database **before** redeploying the agent (the 025/0028 rule:
new-agent-on-old-schema must degrade, but do not rely on it in a planned deploy).

```
# verify the columns landed, and that they are all nullable
select column_name, is_nullable from information_schema.columns
 where table_name = 'mandates' and column_name in
 ('exposure_limit_usdc','exposure_limit_pct_bps','goal_target_usdc','goal_target_date',
  'allowed_protocols','contribution','risk_tier');
```

## 3. Live matrix on alpha

Signed in with the test wallet (mandate v6, growth, $1,503.26 in the vault, 0 idle USDC).

| # | Check | Pass criteria | Baseline (Aug 3, before 030) |
|---|---|---|---|
| SC-001 | `/strategies` card count | **2** cards, each policy-stamped independently, each stating its fee stance and who manages it | 1 card, always |
| SC-002 | Risk badge + fit line | Both change with the saved plan; neither claims a plan the user didn't set | `risk: 1` and "Fits your plan: lower risk" hardcoded — shown to a *growth* mandate |
| SC-003 | Money framing | Each card shows projected $/yr on the user's own balance and the idle baseline, with the testnet caveat | percent only |
| SC-004 | Confirm carries the choice | `/confirm/deposit` opens with the strategy and amount known; the resulting activity appears in the Outcome Log attributed to that recommendation | no rec id, no amount — attribution broken from this entry point |
| SC-005 | Mandate captures four new things | Exposure limit, goal amount + date, protocol comfort, contribution intent all persist and read back | none exist |
| SC-006 | The assistant's invitation is true | Ask "should I put my life savings in?", follow the invitation to set a limit, and complete it | the boundary invites a limit the schema cannot hold |
| SC-007 | One risk scale, no contradictions | Same tier in onboarding, Settings and every card; no summary contradicts itself, **including mandate v6** | 5/5 in summary, 4/5 in Settings, "High risk (5/5), capital-preservation-first." live |
| SC-008 | Goal progress | Share of target + date, shortfall stated plainly | no target can exist |
| SC-009 | Drift both ways | A growth mandate holding only the tier-1 vault reads *below plan*, not "on plan" | "on plan" unconditionally |
| SC-010 | Nothing regressed | The 029 battery re-runs unchanged; policy verdicts byte-identical for both strategies across all three profiles | 029 = 7/7 |

## 4. The parity check that matters most

The risk-class change makes policy step 5 capable of rejecting where it previously could not.
Before/after, for **both** strategies × **all three** mandate profiles, assert the verdict, the
reason codes and the full check trace are identical. Any difference is a real behaviour change and
must be explained, not accepted.

```
cd services/agent && uv run python -m pytest tests/policy -q -k "parity or mandate"
```

## 5. Deploy

Apply 0033 → redeploy agent → redeploy web → poll ~3 min for `exited:unhealthy` and restart if seen
(the standing Coolify rule). `knowledge_seed` is untouched by this feature, so no reingest is needed.

## 6. What "done" looks like

Two honest cards, a plan that holds what the assistant tells people to set, one risk number
everywhere, and a progress line for the goal the user actually named — with every existing safety
behaviour byte-identical.
