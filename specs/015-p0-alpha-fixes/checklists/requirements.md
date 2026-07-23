# Requirements Checklist — 015 P0 Alpha Fixes

Traceability + quality gate for the six fixes. Each item maps to an FR/US in [spec.md](../spec.md).

## Correctness & honesty
- [ ] US1: persisted mandate == the mandate shown on the final onboarding step (no server-default recompute). (FR-001)
- [ ] US1: `riskProfile ∈ {conservative,moderate,growth}` for every tier 1..5; tier ≥ 4 never 400s. (FR-001)
- [ ] US1: save is awaited with saving/saved/error UI; no silent offline no-op or advance-on-failure. (FR-002)
- [ ] US2: three mandate surfaces show the real mandate or an honest fallback; zero hardcoded tier-1 renders remain. (FR-003, FR-004)
- [ ] US3: live rec cards show real rationale + citation chip; mock fallback unchanged; malformed citations dropped safely. (FR-005)
- [ ] US4: canonical disclosure rendered verbatim (byte-locked by test) on both mounts + "Management fee · 0% — none" row. (FR-006)
- [ ] US4: withdrawal receipt shows live-% accrued-fee line, no fabricated $, wrapper discloses stacked curator fee. (FR-007)
- [ ] US5: caps read live from CapRegistry with per-cap mirror fallback; tracks a `setPerUserCap` change. (FR-008, FR-009)
- [ ] US6: `/confirm/deposit?assets=…` renders the identical real gate; no-amount → live entry; swap/premium/bridge → placeholder. (FR-010)

## Non-custody & safety (constitution)
- [ ] No fix moves funds, gates withdraw/exit (N2), or makes a non-approved action signable. (FR-012)
- [ ] Deposit stays beta-gated in the routed confirm; withdraw is never beta/pause/cap-gated. (FR-010)
- [ ] Caps change is display-only; enforcement still uses on-chain `maxDeposit`. (FR-008)
- [ ] `signable ⟺ policy.status === "approved"` preserved on rec cards + the gate. (Principle II)

## Scope & process
- [ ] No agent / contract / DB / migration change; all diffs within `apps/web`. (FR-011)
- [ ] New logic lives in dependency-free `lib/` modules with type-only cross-imports; `*.test.ts` pass under strip-types. 
- [ ] `pnpm --filter web test` + `build` green; agent contract tests re-confirmed green.
- [ ] `CHANGELOG.md` + `whats-new.json` updated; `changelog-required` CI green.
