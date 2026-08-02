# Implementation Plan: Sparky Memory v2 — Platform-Activity Awareness

**Branch**: `feature/028-memory-activity-fold` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/028-memory-activity-fold/spec.md`

## Summary

Fold the user's real platform actions — indexed vault deposits/withdrawals, app-signed executions, swaps, and faucet claims — into the existing feature-027 memory digest via a **lazy, fail-open fold at chat-turn start**, tracked by a new per-user `activity_cursor` (migration 0031). Pure derivation module + one fold orchestrator; no new indexing, no background jobs, no new endpoints; one web string. All memory-v1 guarantees (40-line cap, 120-char clamp, sanitize/fence, prose/classifier-only boundary, Settings visibility, Clear) are inherited unchanged; Clear keeps the cursor so cleared activity never resurrects.

## Technical Context

**Language/Version**: Python 3.12 (services/agent, FastAPI, strict mypy); TypeScript (apps/web — one string only)

**Primary Dependencies**: existing only — asyncpg, httpx (keyless JSON-RPC), FastAPI. No new packages.

**Storage**: PostgreSQL (shared develop DB, **SQL_ASCII** — all jsonb writes `ensure_ascii=False`). Migration `0031_user_memory_activity_cursor.sql`: `ALTER TABLE user_memory ADD COLUMN IF NOT EXISTS activity_cursor JSONB` (nullable, additive, order-insensitive with fallback).

**Testing**: pytest (agent; fakes for stores, no live DB), node:test + typecheck:test (web — existing memory disclosure test only). CI scope: `ruff check .`, `mypy src/sparkpoint_agent` (strict), pytest.

**Target Platform**: the deployed develop agent (Coolify, Base Sepolia + Robinhood testnet data)

**Project Type**: web-service increment (agent-internal; zero new API surface)

**Performance Goals**: fold adds ≤3 bounded DB reads + ≤1 keyless eth_call (3s hard timeout) per chat turn — negligible vs the 5–15s LLM call; a fold failure or timeout costs nothing but staleness.

**Constraints**: fail-open everywhere (missing 0031 column ⇒ fold disabled via `UndefinedColumnError` catch, warn once); exactly-once folding (cursor advanced atomically with the append); first-fold backfill K=5, ≤10 lines/fold; memory boundary unchanged (never propose/gate/build-tx).

**Scale/Scope**: alpha user counts; per-user reads are indexed (`executions_account_idx`, `onchain_events` owner filter, new swap query uses the block index + from_address filter).

## Constitution Check

*Gate evaluated against constitution v3.0.0 — PASS (pre-research; re-checked unchanged post-design).*

- **I. Non-custodial (N1–N5)**: read-only derivation from existing records + one keyless `eth_call`. No signing, no key material, no fund movement; never on the withdraw path (a total fold outage degrades to memory v1). PASS.
- **II. AI proposes, policy disposes**: activity lines join the digest that reaches ONLY the intent classifier + Sparky prose. The existing byte-identical-verdict boundary test is EXTENDED to activity lines (FR-008/SC-006). Nothing here touches propose/gate/build-tx. PASS.
- **III. Provable, not promised**: every line derives from an on-chain-anchored record; the swap notional is an estimate and is labeled `~` (approximate); faucet amounts are omitted rather than guessed. PASS.
- **IV. Bounded blast radius**: caps at every layer (per-source LIMIT 25, fold ≤10 lines, digest ≤40, line ≤120 chars, RPC 3s timeout); fail-open with once-per-process warning (`user_memory_fold_failed`), the post-#125 discipline. PASS.
- **Whitelist/protocol rules**: not applicable — no protocol interaction.

## Project Structure

### Documentation (this feature)

```text
specs/028-memory-activity-fold/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1 (validation guide)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

*(No `contracts/` — this feature adds zero external interface: no new/changed endpoints, no wire-shape change. `GET /memory/self` already returns lines verbatim; activity lines are just more lines.)*

### Source Code (repository root)

```text
services/agent/
├── migrations/0031_user_memory_activity_cursor.sql        # NEW
├── src/sparkpoint_agent/
│   ├── activity.py                                        # NEW — pure derivation (mirrors memory.py style)
│   ├── memory.py                                          # unchanged (line clamp/render reused)
│   ├── chain/faucet_probe.py                              # NEW — keyless nextClaimAt/cooldown read, 3s budget
│   ├── db/user_memory.py                                  # EXTEND — cursor read + append_with_cursor (one txn)
│   ├── db/swap_fees.py                                    # EXTEND — list_for_swapper(network, from, after, limit)
│   └── api/chat.py                                        # EXTEND — _MemorySink.fold_activity() at turn start
├── content_seed/whats-new.json                            # entry (CI gate)
└── tests/
    ├── test_activity.py                                   # NEW — pure derivation
    ├── db/test_user_memory.py                             # EXTEND — cursor semantics
    ├── chain/test_faucet_probe.py                         # NEW
    ├── api/test_chat.py                                   # EXTEND — fold wiring, fail-open
    └── coordinator/test_memory_boundary.py                # EXTEND — activity lines byte-identical verdicts

apps/web/src/app/(app)/settings/page.tsx                   # ONE string (memory disclosure)
MIGRATIONS.md · CHANGELOG.md                               # living docs
```

## Phase 0: Research

All unknowns resolved — see [research.md](./research.md). Headlines: executions are keyed by `account.account` while flows/swaps/faucet key on `account.owner` (identical today — the BFF sets both from the session address — and correct if they ever diverge); `SwapFeeStore` needs one new per-swapper query; the faucet probe reuses the keyless `eth_call` pattern with a hard 3s budget (improving on the 026 gate's known gap).

## Phase 1: Design

- [data-model.md](./data-model.md) — the `activity_cursor` JSONB shape, the `ActivityEvent` internal model, line formats, and cursor-advance rules (including the deferred-pending rule for executions).
- [quickstart.md](./quickstart.md) — the runnable validation guide: unit/CI gates, then the live alpha scenario matrix (manual deposit → recall; drawer execution → via-Sparky label; swap + faucet lines; clear-no-resurrect; triple-turn no-duplicates).
