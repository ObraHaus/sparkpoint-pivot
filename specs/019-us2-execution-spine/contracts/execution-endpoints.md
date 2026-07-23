# Phase 1 — Interface Contract: Execution Endpoints

Concrete request/response shapes for the four new agent endpoints, reconciling the authoritative
`specs/001-sparkpoint-pivot-mvp/contracts/agent-service-api.md` §3.5/§3.6 with the as-built pydantic
model style (all response/request models `ConfigDict(extra="forbid")` + camelCase, byte-parity with
`packages/shared/src/schemas/*`). Money = base-unit integer **strings**; `signature` is **always
null** from the service. Auth/headers/idempotency are the global middleware's (S2S bearer,
X-Account/X-Owner/X-Chain-Id, Idempotency-Key) — no per-endpoint code.

Router: `api/execution.py` = `APIRouter(tags=["execution"])`, full paths, registered in `api/main.py`.

---

## `POST /build-tx` — materialize an unsigned IntentBundle

**Request** (`BuildTxRequest`):
```jsonc
{
  "action": {
    "type": "vault_deposit",          // vault_deposit | vault_withdraw | vault_redeem (testnet scope)
    "asset": "0x<usdc>",              // TOKEN ADDRESS (not the symbolic enum)
    "decimals": 6,
    "amount": "100000000",            // base units; for redeem this is shares
    "params": { "maxSlippageBps": 50 },   // OPTIONAL; ignored on the vault path (swaps only)
    "recommendationId": "rec_vault_deposit"  // OPTIONAL link hint
  },
  "execMode": "per_action"            // per_action (default). session_key rejected until US6.
}
```

**Response 200** (`{ intentBundle: IntentBundle }`): the `IntentBundle` (§2.1) with:
- `steps[0]` = `{ chainId, opType:"eoa_call", to:<vault>, value:"0", data:<unsigned calldata>, label }`
- `userOp: null` (eoa_call), `simulation: SimulationResult`, `policyVerdict: {approved:true,…}`,
  `guardrailChecklist: [...]`, `rationale`, `citations`, `recommendationId?`, `policyVersion`,
  `expiresAt`, `id` (= intent_action_id), `userId` (= owner), `kind`.

**Errors** (§1.5 envelope, `reasons[]`, **no bundle**): `VALIDATION_ERROR` (400), `POLICY_REJECTED`
(422), `CAP_EXCEEDED` (422, deposit only), `SLIPPAGE_EXCEEDED` (422, swaps), `SIMULATION_REVERT`
(422, deposit), `SIMULATION_UNAVAILABLE` (503; swaps/direct-Aave fail closed; vault deposit may fall
back to the local dry-run), `DATA_STALE` (409), `KILL_SWITCH_PAUSED` (409 — **deposits only, NEVER
withdraw/redeem**).

**Non-custody**: recipient forced to `X-Owner`; `signature` null; a withdraw/redeem builds even when
paused/at-cap/stale/no-sim and never returns `KILL_SWITCH_PAUSED`/`CAP_*`/`DATA_STALE`.

## `POST /simulate` — standalone re-simulation (refresh)

**Request**: `{ "intentId": "…" }` (refresh a stored bundle) OR `{ "steps": [ … ] }` (preview).
**Response 200**: `{ "simulation": SimulationResult }`.
**Errors**: `SIMULATION_REVERT`, `SIMULATION_UNAVAILABLE`, `NOT_FOUND`, `DATA_STALE`.

## `POST /submit-signed-tx` — relay a USER-signed payload (convenience)

**Request** (`SubmitSignedRequest`):
```jsonc
{
  "intentId": "…",
  "signed": {
    "opType": "eoa_call",             // eoa_call (testnet) | userop (US6)
    "userOp": null,                   // present when opType=userop (signature NON-null, from WALLET)
    "rawTx": "0x…",                   // signed raw tx OR a submitted txHash for correlation
    "txHash": "0x…"                   // OPTIONAL: the hash the frontend already broadcast (direct submit)
  }
}
```
**Validation**: the signed `to`/`data`/`value`/sender MUST byte-match the issued bundle's step (else
`VALIDATION_ERROR`); a null signature is rejected. The service does **not** re-sign or alter.

**Response 202**: `{ "submission": { "intentId":"…", "status":"pending", "userOpHash":null, "txHash":"0x…"|null, "bundler":null } }`.
**Errors**: `VALIDATION_ERROR` (mismatch / null signature), `NOT_FOUND` (unknown intent),
`UPSTREAM_UNAVAILABLE` (RPC/bundler). **NEVER `KILL_SWITCH_PAUSED` for a withdraw payload.**
**Effect**: inserts one `executions` row (`submitted`, unique on `intent_bundle_id`).

## `GET /submit-signed-tx/{intentId}` — poll status

**Response 200**: `{ "status": "pending"|"confirmed"|"failed", "txHash": "0x…"|null, "blockNumber": 0|null, "receipt": { … lite } | null }`. Updates the `executions` row on confirmation/failure.
**Errors**: `NOT_FOUND`.

---

## New pydantic wire models (`execution/models.py`) — byte-parity with zod

| Model | Mirrors zod | Key fields (camelCase, `extra="forbid"`) |
|---|---|---|
| `IntentStep` | `IntentStepSchema` | `chainId:int`, `opType:Literal["userop","eoa_call"]`, `to:str`, `value:str`, `data:str`, `label:str` |
| `PackedUserOperation` | `PackedUserOperationSchema` | all hex fields; `signature: None` (always null) |
| `IntentBundle` | `IntentBundleSchema` | `id`, `userId`, `kind`, `steps:list[IntentStep]`, `userOp:PackedUserOperation|None`, `simulation:SimulationResult`, `policyVerdict:WirePolicyVerdict`, `guardrailChecklist:list[GuardrailCheck]`, `rationale`, `citations:list`, `recommendationId:str|None`, `policyVersion`, `expiresAt` |
| `WirePolicyVerdict` | `PolicyVerdictSchema` | `approved:bool`, `policyVersion`, `reasons:list[Reason](≥1)`, `normalizedAction:ProposedAction|None`, `simulation:SimulationResult|None` |
| `Reason` | `ReasonSchema` | `code:ReasonCode`, `message:str` |
| `GuardrailCheck` | `GuardrailCheckSchema` | `id`, `label`, `status:Literal["pass","fail","warn"]`, `detail:str|None` |
| `SimulationResult` | `SimulationResultSchema` | **already mirrored** in `sim/simulator.py` — reused as-is |

A serializer (`serialize.py`) maps the internal `policy.PolicyVerdict` dataclass → `WirePolicyVerdict`
(status→`approved` bool, `tuple[ReasonCode]`→`[{code,message}]`, drop `trace`, attach `simulation`,
`normalized_action` Action→`ProposedAction` wire). A parity test asserts the field-sets match the zod
`.strict()` schemas.

## Guardrail checklist mapping (rendered in the ExecutionDrawer)

The bundle's `guardrailChecklist` is derived from the verdict `trace` (1:1 with the six guardrails +
the recipient check): `protocol_allowlisted`, `recipient_is_you` (N1), `within_caps` (skipped/`warn`
n/a on exit), `simulation_passed` (advisory on exit), `mandate_conformant`, `not_paused`
(skipped on exit), `slippage_ok` (n/a on vault). Each `status ∈ pass|fail|warn`.
