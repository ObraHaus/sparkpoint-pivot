# Bundler spike — SAFE-MODE + mode-0x01 session-key UserOp (item 6 / P1.5)

> **⛳ SUPERSEDED / RESOLVED (feature 022, US6 — 2026-07-24).** The blocker this spike surfaced — a
> `recordSpend`-in-validation write to the *external* PolicyModule at a slot associated with the
> **sessionKey** (not the sender) — has been fixed by **Path A**: ALL per-session state (policy, caps,
> monotonic `spent`, and the session's allowlist snapshot) now lives in `SparkPointAccount`'s **own**
> storage, so `validateUserOp` reads/writes only account-own storage ([STO-010], unambiguous). See
> `specs/022-us6-session-key-automation/` (research.md R1) and the refactored contracts. The definitive
> ERC-7562 verdict is now obtained by submitting a mode-0x01 UserOp to the **real Alchemy Base-Sepolia
> bundler** (Rundler, EntryPoint v0.7), which decodes v0.7 correctly (unlike the local Alto-0.0.20
> harness below). The two spike deploy scripts (`BundlerSpikeDeploy.s.sol`,
> `BundlerSpikeSessionDeploy.s.sol`) were retired with the fix; the raw logs + this analysis remain as
> the historical evidence trail that drove the resolution.

**Question (operator):** re-run the ERC-4337 v0.7 spike with Alto `--safe-mode true` and a
**mode-0x01 session-key** UserOp — the path where `SessionKeyValidator.validateUserOp` calls
`policyModule.recordSpend(...)` **during validation** (a write to the *external* PolicyModule).
Does it survive the ERC-7562 validation rules? *"If it fails 7562 rules, that's exactly what we
need to know… report it, don't tune it away."*

**Harness:** local Anvil fork of Base (chainId 8453) + Pimlico Alto `0.0.20` `--safe-mode true`.
`BundlerSpikeSessionDeploy.s.sol` deploys the stack, seeds the vault-deposit allowlist, and
authorizes one session key; `submit-session-userop.sh` submits `execute(vault,0,deposit(100 USDC,
account))` signed by the session key (mode `0x01`). Reproduce: `bash run-spike-safemode.sh`.

## Verdict: NO CLEAN ACCEPT/REJECT — blocked by a bundler-tooling limitation, NOT tuned away

`eth_sendUserOperation` returned, **verbatim** (see `safemode-logs/submit.log`):

```
{"error":{"message":"Encoded error signature \"0x99410554\" not found on ABI. ... viem@2.55.2"}}
```

`0x99410554` = **`delegateAndRevert(address,bytes)`** — the EntryPoint-v0.7 primitive Alto uses to
run `simulateValidation`. Alto 0.0.20's viem can't decode the wrapped result against this fork, so
it errors **before** rendering a 7562 storage-rule verdict.

**This is a tooling issue, not the recordSpend path — proven by an owner-mode control.** The exact
same fork + safe-mode Alto was given a **mode-0x00 owner** UserOp (no `recordSpend`, no external
write). It failed **identically** with `0x99410554` (`safemode-logs` control run). Since the op that
never touches `recordSpend` fails the same way, the failure is Alto-0.0.20's safe-mode simulation
decode on Anvil — not the session-key validation write.

## What the safe-mode TRACER did capture (the real 7562 risk surface)

The ERC-7562 validation tracer **did** execute (Anvil supports the JS tracer) and its raw result is
in `safemode-logs/validation-trace-excerpt.log`. During the session-key validation it recorded, in
`callsFromEntryPoint[0].access`:

- account `0xdcec…e1b0` (the sender): reads only — its own storage. ✅
- **PolicyModule `0x6379…06e2` (external): `"writes": { "0x23a9…818c6": 1 }`** ⬅️ the `recordSpend`
  write to `_policies[account][sessionKey].spent`, performed **during validation** by the
  (unstaked) SessionKeyValidator.

That external-contract storage **write during validation** is precisely what EIP-7562 scrutinizes.
The slot is a nested mapping — `keccak(sessionKey ‖ keccak(account ‖ base))` — so whether it
qualifies as **sender-associated storage** ([STO-032]/[STO-033], which would permit it) is a **gray
area**: the sender (`account`) is the *inner* mapping key, not the outermost. An unstaked entity
writing a *non*-sender-associated external slot in validation is a **[STO-021]/[STO-022] violation**.

## Bottom line + Phase-3 recommendation (reported, not resolved here)

- The **local Anvil + Alto-0.0.20 harness cannot render a definitive safe-mode verdict** (decode
  limitation, control-proven). We did **not** tune the op to make it pass.
- The **architectural risk is real and confirmed by the tracer**: session-key validation writes to
  an external, unstaked contract's storage, at a slot whose sender-association is not clear-cut.
- **Before Phase-3 AA, settle it one of these ways:**
  1. Run this same mode-0x01 op against a **real tracing node** (geth `debug_traceCall` + the
     canonical bundler tracer) or a **hosted Base-Sepolia bundler** (managed Pimlico/Alto) to get
     the actual [STO-*] verdict. *(Requires a testnet broadcast of the account stack — out of this
     LOCAL-only spike's scope; deliberately not done here.)*
  2. If it fails: move the in-validation spend write into the **account's OWN storage** (the sender),
     which is unambiguously permitted, and reconcile to the PolicyModule post-execution; **or stake**
     the PolicyModule as an ERC-4337 entity so its associated-storage access is allowed.

## Files

- `BundlerSpikeSessionDeploy.s.sol` — stack + allowlist + session authorization (spike-only, local).
- `submit-session-userop.sh` — builds/signs the mode-0x01 op; prints the raw bundler response.
- `run-spike-safemode.sh` — orchestrates Anvil + Alto `--safe-mode true` + submit.
- `safemode-logs/{submit.log,deploy.log,validation-trace-excerpt.log}` — raw evidence (secret-free;
  the fork RPC is a private-LAN anvil, never printed). Full Alto debug log is reproducible via the
  runner.
