# Quickstart — Validating the US2 Execution Spine

A runnable validation guide proving the feature works end to end. Details live in
[plan.md](./plan.md), [data-model.md](./data-model.md), and
[contracts/execution-endpoints.md](./contracts/execution-endpoints.md).

## Prerequisites

- Agent + web running (locally or on alpha). Base Sepolia (84532) vault deployed
  (`SPARKPOINT_VAULT_ADDRESS` set for chain 84532).
- Migration `0021_execution.sql` applied (`intent_bundles` / `simulation_results` / `executions`
  exist).
- A beta-allowlisted, funded testnet wallet (the deployer `0xA71e24…5c30` works).

## Agent unit / contract tests (fast, no chain)

```bash
cd services/agent
uv run ruff check src
uv run mypy src                 # STRICT — blocking
uv run pytest tests/api/test_build_tx.py tests/api/test_submit_signed.py \
              tests/execution/ tests/policy/ -q
```

Expect: build-tx returns a bundle (recipient=owner, signature=null, approved verdict, persisted sim)
for an approved deposit; returns a reasons envelope + no bundle for over-cap; a withdraw builds under
a hostile ctx (paused+cap+stale+no-sim) and never returns `KILL_SWITCH_PAUSED`; submit byte-match
rejects a tampered payload; the parity test passes.

## Web unit tests

```bash
cd apps/web
pnpm run typecheck && pnpm run typecheck:test && pnpm run lint
node --experimental-strip-types --test "src/lib/execution/**/*.test.ts"
pnpm run build
```

Expect: `executionModel` byte-match + expiry helpers pass; the ExecutionDrawer renders a bundle and
gates Sign on approved+unexpired+chain-match.

## Shared parity

```bash
cd packages/shared && pnpm run build
# the new zod<->pydantic field-set parity test (agent side) must be green
cd ../../services/agent && uv run pytest tests/execution/test_wire_parity.py -q
```

## End-to-end on alpha (SC-007 — the acceptance bar)

Authenticated via the real SIWE flow with the deployer key (see the ops runbook), then:

1. **Build**: `POST /api/agent/build-tx` with an approved `vault_deposit` of a small USDC amount →
   expect `200 { intentBundle }` whose `steps[0].to` == the vault, `userOp:null`, `simulation.willRevert:false`,
   `policyVerdict.approved:true`, a fresh `expiresAt`, and a stable `id`. Confirm rows exist in
   `intent_bundles` + `simulation_results` (the bundle references the sim).
2. **Reject**: `POST /api/agent/build-tx` with an over-cap deposit → expect a `422 POLICY_REJECTED`/`CAP_EXCEEDED`
   envelope with `reasons[]` and **no** `intentBundle`.
3. **Withdraw is sacred (N2)**: `POST /api/agent/build-tx` with `vault_redeem` → expect a signable
   bundle even if the kill-switch is paused; confirm the response is never `KILL_SWITCH_PAUSED`.
4. **Sign (drawer)**: in the UI, open the ExecutionDrawer on the approved deposit; verify the
   checklist + deltas + rationale render; sign with the wallet; verify the signed tx `to`/`data`
   byte-match the bundle's `steps[0]` (SC-005).
5. **Submit + status**: `POST /api/agent/submit-signed-tx` with the signed payload/hash → `202 pending`
   + one `executions` row; `GET /api/agent/submit-signed-tx/{intentId}` → moves to `confirmed` with a
   real `txHash` + block once mined. Confirm the row is reconstructable from chain.
6. **No regression**: the manual vault deposit/withdraw ConfirmFlow and the direct `/exit` path still
   work unchanged (SC-008).

## Non-custody spot checks

- Grep the wire: no response from the service ever carries a non-null `signature` (the drawer's raw
  submit is the only place a signature appears, inbound, from the wallet).
- The `/exit` page and Trust Center are unchanged and do not route through `/api/agent/*`.
- Every displayed amount is a base-unit integer string; USD are decimal strings.
