# Data model — 030

## Mandate: four new fields

All additive and **nullable**. `NULL` means *the user never said*, which is distinct from zero and
must be rendered as such everywhere (FR-021).

| Field | Type | Semantics |
|---|---|---|
| `exposure_limit_usdc` | `NUMERIC(38,0)` null | Most the user is willing to have at risk, in USDC base units (6 dp). Mutually exclusive with the percent form. |
| `exposure_limit_pct_bps` | `INT` null | Same limit expressed as a share of wallet value, in basis points (2500 = 25%). |
| `goal_target_usdc` | `NUMERIC(38,0)` null | Target amount, USDC base units. |
| `goal_target_date` | `DATE` null | Target date. A target-seeking goal requires BOTH this and the amount (FR-011). |
| `allowed_protocols` | `JSONB` null | Protocols/assets the user is comfortable with, e.g. `["aave_v3"]`. `NULL` = no preference stated = today's behaviour. Written with `ensure_ascii=False`. |
| `contribution` | `JSONB` null | Stated intent, e.g. `{"amountUsdc": "200000000", "cadence": "monthly"}`. Projection and reminders only. |
| `risk_tier` | `SMALLINT` null | The 1..5 tier the user actually chose, stored alongside the profile so the display can be faithful. **Never read by the policy gate.** |

### Invariants

- **Advisory only.** No field here authorises anything. The mandate may narrow what is proposed; it
  can never widen what policy permits.
- **Exposure limit is a proposal-time bound**, not an on-chain cap. The deterministic caps are
  unchanged and continue to apply independently.
- **`risk_tier` is display-only.** `risk_profile` remains the single value the policy layer reads.
  If the two ever disagree, `risk_profile` wins and the tier is re-derived from it.
- **A goal is atomic**: amount without date, or date without amount, is not a goal and is not stored
  as one.
- **Percent-form exposure needs a wallet value.** When the wallet value is unknown, a percent limit
  is treated as *not stated* rather than resolved against a guess.

### Migration 0033 — additive, order-insensitive

`ALTER TABLE mandates ADD COLUMN … ` for each, all nullable, no backfill, no default. A new agent
against an old schema must degrade to pre-030 behaviour rather than 500 — the 025/0028 lesson, which
is why the reads catch `UndefinedColumnError` once and warn once per process.

An old agent against the new schema is unaffected: every column is nullable and nothing reads it.

## Strategy metadata (not persisted)

Carried on the recommendation wire so the card can be truthful. Derived in code from the fixed
allowlist; no runtime configuration, no curation surface.

| Field | Meaning |
|---|---|
| `riskTier` | The strategy's own 1..5 tier, from its `RiskProfile`. |
| `feeStance` | `"managed_fee"` (vault: 10% of yield, profit only) or `"no_platform_fee"` (direct supply). |
| `managedBy` | `"sparkpoint"` or `"self"`. |

## Derived, never stored

- **Projected annual earnings** — balance × net rate, exact integer arithmetic, alongside the
  do-nothing baseline of zero.
- **Goal progress** — share of target, time remaining, on-pace judgement.
- **Drift** — `above_plan | on_plan | below_plan | unknown`.
- **Plan summary** — derived at display time from profile + tier, so stale stored strings stop being
  authoritative.
