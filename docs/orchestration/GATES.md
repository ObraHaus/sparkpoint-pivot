# SparkPoint Phase 2 — Wave & Gate Ledger

Driver-loop state for the ultracode build (plan **rev 3.3**, artifact `31e5f3f5`).
Per-wave headless sessions + the watchdog read `wave-state.json`; this file is the human-readable log.

## Gates
- **Gate A — APPROVED (2026-07-13):** git patch approved · Obsidian into Phase 2 (T121–T126) · full working MVP scope · hosting resolved (16c/cap 14).
- **Gate B — WAITING:** MVP STOP-AND-VALIDATE. Clears when the §09 GO checklist is green **and** the withdraw-always drill (redeem offline + `paused()==true`, funded with Aave-reserve USDC) is physically performed on Base Sepolia.
- **Gate C — WAITING (Phase 3+):** mainnet. Requires the recorded internal security audit + hardening sign-off (T103). **Never autonomous.**

## Autonomy boundaries (enforced)
- Git on `develop` + `feature/*` is autonomous; `main`/`master` push+merge, mainnet broadcast, `cast send` to mainnet, and force-push are **hard-denied** by `.claude/hooks/guard-dangerous.sh` (PreToolUse, tested 22/22) + permission deny rules.
- Every human gate = a `wave-state.json` write + `coder_report_task state=failure` + this log.

## Log
- **2026-07-13 — W0 opened.** Safety layer landed: deny-hook tested 22/22 + git-autonomy permissions applied (deny-hooks-first). Toolchain (foundry/slither) installed. Speckit repointed to `specs/001-sparkpoint-pivot-mvp`. Branch: `feature/w0-foundation`.
- **2026-07-13 — W1 skeletons landed.** contracts (Foundry OZ5/AA0.7/Solady, cancun/0.8.24), services/agent (FastAPI /healthz), packages/shared (SoT seam), green-by-skip CI (N1-N5 required, T098, T126, deploy-testnet gated), .env.example. All build; apps/web green.
- **2026-07-13 — W1 CI GREEN.** Pushed `feature/w0-foundation`; all workflows pass (contracts/web/agent/knowledge-boundary/policy-parity). Fixed agent PEP-668 (uv venv) + web next-env.d.ts. **W1 barrier met.** → W2.
