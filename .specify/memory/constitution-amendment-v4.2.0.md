# Constitution Amendment v4.1.0 → v4.2.0 (MINOR — active-build scope)

**Date:** 2026-09-20 · **Operator:** aldrickb · **Status:** ratified by operator directive · **Classification:** **MINOR** — a scope clarification, not a principle change.

N1–N5, the fee model, the pause-only kill-switch, the AI-disposition rule and every custody guarantee are **unchanged**. The Base/Aave launch vault and the Sui follow-on remain ratified designs but are **deferred with no committed date**; this amendment governs what the product builds and presents *now*.

## Directive

> *"we are not going to do base network or aave vault anytime soon"*

## What this records

- The **active product** is the **Robinhood Chain 4663 curated-wrapper program**: the AI-curated board, the V3 admission fleet (AI cooldown-gated admission + operator instant lane), wrapped-vault deposits/withdrawals, the beta swap, and the portfolio.
- The **Base launch network**, the **Aave Yield Vault** and the **Sui follow-on** are **unscheduled**. No user-facing surface may present them as upcoming until a superseding amendment schedules them.
- The clauses that define the launch vault and the multi-network plan remain on the record as ratified design; they are simply not the current build. The launch-default language in Principle V and the Base/Sui scope in **Chain & scope** are **deferred, not removed**.

## Delta to `constitution.md`

| Clause | Before (v4.1.0) | After (v4.2.0) |
|---|---|---|
| **Principle V** | "The launch DEFAULT vault MUST be a single conservative Aave Yield Vault…" | Same clause **plus** the active-build note: the Base launch is deferred and unscheduled; the active product is the 4663 curated-wrapper program; no user-facing surface may present the deferred plan as upcoming. |
| **Chain & scope** | "Multi-network: Base (launch) + Sui (fast-follow) + Robinhood Chain (mainnet 4663…)" | Same record **plus**: the **active build** is the 4663 curated-wrapper program; Base and Sui are unscheduled and must not be presented as upcoming. |
| **Timeline** | "12-week build, Jun 1 – Sep 4, 2026. Target: production-ready on Base…" | Marked **historical** — superseded by the active-build scope; no Base date is committed. |
| **Version** | 4.1.0 | **4.2.0** (MINOR), amendment log entry added. |

## Why MINOR

The change does not remove, redefine or weaken any principle: it records **which ratified scope is being built now**. The Aave/Base design clauses stay verbatim; the deferral is explicitly reversible by a future amendment. Nothing about custody, fees, admission bounds, exits or the timelock changes.

## Companion artifacts

- `constitution.md` version + amendment log updated (this change).
- The app copy pass (vault picker, deposit/withdraw notices, strategies, fees, portfolio) ships separately and names no deferred scope.
