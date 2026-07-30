# T103 — mainnet audit readiness

**Prepared 2026-07-30**, against `develop@cdd22a7` (feature 023 merged, agent redeployed and
smoke-tested live).

This is the prep for the Gate C audit precondition. It exists because "run the audit" is not one task
— **it is two, with different owners** — and because reading T103's actual text turned up a narrower
scope than the shorthand suggests.

---

## 1. Scope correction (read this first)

T103's own definition in [`specs/001-.../tasks.md:399`](../../specs/001-sparkpoint-pivot-mvp/tasks.md)
is a **contracts + CI** task:

> Testnet + mainnet deploy workflows … run N1–N5 invariant suite + post-deploy `AssertNonCustody` as
> required gates before any deploy; the **mainnet deploy additionally REQUIRES a recorded
> internal-team security audit/hardening sign-off for every contract** … the workflow gates on this
> sign-off, not the invariant suite alone.

So T103 is **not** the app-layer audit. It is: *the contract audit, plus a deploy workflow that
mechanically refuses to broadcast to mainnet without a recorded sign-off.* The constitution's
"Contract audit before mainnet" rule says the same thing — "no **contract** may be deployed to Base
mainnet until the internal team's security audit and hardening have been completed for that contract."

The app-layer audit is a **separate, also-required** piece of work. Calling it T103 conflates two
gates; this document keeps them apart:

| | **T103** (contracts + CI) | **R2** (app layer) |
|---|---|---|
| Covers | The 11 Solidity contracts + the mainnet deploy gate | agent service, web, policy layer, data layer |
| Required by | Constitution "Contract audit before mainnet"; `tasks.md` T103 | Prudence — R1's own round-2 list, plus ~11k lines shipped since |
| Blocking Gate C | **Yes**, explicitly | Yes in practice (custody-adjacent code, never audited) |
| Status | **Not started.** `deploy-mainnet.yml` does not exist. | **Not started.** R1 was 2026-07-21. |

---

## 2. Two concrete gaps found while preparing this

**(a) `deploy-mainnet.yml` does not exist.** `.github/workflows/` has `deploy-testnet.yml` and no
mainnet counterpart. T103's deliverable is therefore unbuilt, not merely unrun. The testnet workflow is
a good template — it already runs `forge build`, the N1–N5 invariant suite, an `AssertNonCustody`
precondition dry-run against the live vault, a non-broadcast simulation, an assert-that-forge-sent-
nothing check, and a post-sim `AssertNonCustody` verify. Notably it also carries a **mainnet guard**
that fails if the target is 8453 — so the mainnet workflow is not a copy-paste; that guard has to
invert, which is exactly the kind of edit that deserves review rather than a quick sed.

**(b) The R1 audit report is not in the repo.** R1 (2026-07-21, full-depth adversarial, report-only:
0 critical / 0 high survived, 3 medium, ~15 low, 7 info, plus a listed round-2 seam set) was delivered
as an artifact and **no findings file was ever committed**. Consequences:

- The 3 mediums cannot be tracked to closure in-repo. Two are now resolved (idempotency scoping in
  023; the swap ruling accepted in [D-GC-02](./gate-c-decisions.md)) and the third (S2S / `X-Owner`
  trust) has no recorded status at all.
- R1's own round-2 seam list — the highest-value input to R2 — is not available to whoever runs R2.
- A future auditor cannot tell what was already examined and cleared.

**Recommendation:** before R2 starts, commit an `docs/security/R1-findings.md` transcribed from the
artifact, with a status column. An audit whose findings live outside the repo is an audit that gets
re-litigated.

---

## 3. How to gate a *human* sign-off mechanically

T103 says the workflow gates on the sign-off, "not the invariant suite alone". Prose cannot gate a
workflow, and the playbook is explicit that deterministic beats advisory — so the sign-off needs a
machine-checkable form. Proposed:

```
docs/security/signoff/<contract>@<commit>.md      # one file per audited contract
```

Each carries: contract path, the **exact commit SHA of the contract source** at audit time, auditor,
date, scope, findings + resolution, and an explicit "cleared for Base mainnet" line.

`deploy-mainnet.yml` then, before any broadcast step:

1. computes `git log -1 --format=%H -- contracts/src/<contract>.sol` for every deployable contract;
2. requires a matching sign-off file whose pinned SHA **equals** that value;
3. fails the job — loudly, naming the contract — if any is missing or stale.

The property that matters: **touching a contract after its sign-off invalidates the sign-off
automatically**, because the source SHA moves. A date-based or checkbox-based gate does not have that
property and would silently pass a post-audit edit.

---

## 4. T103 scope — the contracts

11 deployable contracts (interfaces excluded). 29 Foundry test files exist, including `invariant/`,
`fuzz/`, `fork/`, `governance/` and `account/` suites, so this is an audit of tested code, not
untested code.

| Contract | Why it is custody-critical | Priority |
|---|---|---|
| `vault/SparkPointVault.sol` | Holds user funds. N1/N2/N5 live here — pause must never guard withdraw, no admin asset-movement selector, non-upgradeable. | **P0** |
| `account/SparkPointAccount.sol` | The ERC-4337 account. Post-022 it owns **all** per-session state (the Path-A relocation), so `validateUserOp` writes the spend ledger in its own storage. | **P0** |
| `account/SessionScopeLib.sol` | Recovers the session signer and enforces the scope. The mode-`0x01` / EIP-191 scheme the client signs against. | **P0** |
| `account/SessionKeyValidator.sol` | Now a pure validator (post-022). N4's on-chain half. | **P0** |
| `account/PolicyModule.sol` | Now stateless scope-checker + the grant-time global allowlist. | **P0** |
| `vault/SparkPointMorphoVault.sol` | **Superseded for new deployments** by v3.0.0, but existing instances stay redeemable forever (N2) — so it is in scope for *any already-deployed* instance. | P1 |
| `factory/SparkPointVaultFactory.sol` | Deploy-only, CREATE2 full bytecode, no fund path. | P1 |
| `account/AccountFactory.sol` | Counterfactual account deployment. | P1 |
| `governance/KillSwitch.sol` | Pause-only authority. The N2 boundary. | P1 |
| `governance/CapRegistry.sol` | Cap source of truth the off-chain layer mirrors. | P1 |
| `adapters/AaveV3Adapter.sol` | The vault's yield leg. | P1 |
| `token/SparkPointTestToken.sol` | Test SRK. **Not for mainnet** — confirm it is excluded from the mainnet deploy set. | — |

**Audit focus per the constitution's own invariants** — for each contract, the auditor must be able to
state affirmatively: no path withdraws user funds to a SparkPoint address (N1); no key, role or pause
can block a user's exit (N2); the user is the sole admin signer (N3); session keys cannot exceed
on-chain scope (N4); custody semantics are non-upgradeable and the multisig/timelock governs pause
only (N5).

---

## 5. R2 scope — what has never been audited

R1 was 2026-07-21. Everything below landed after it. This is the argument for R2 in one table:

| Landed after R1 | What it introduced | Why it matters for an audit |
|---|---|---|
| **019** execution spine | `/build-tx`, `/simulate`, `/submit-signed-tx`, the byte-match relay | The first code path that turns advice into a signable artifact. Never audited. |
| **022** session keys | `evaluate_session_grant` (a second policy machine), grant/revoke encoding, the client-side key store + signer, the bundler relay | The N4 surface, end to end, including a private key living in a browser. Never audited. |
| **020/021** attribution + notifications | `/outcomes`, the derive-on-read feed, the edge-triggered poller | Reads over user history; the poller makes model calls per wallet. |
| **023** mainnet hardening | chain-identity gate, estimator gas, submit expiry, idempotency scope + durable store | Just shipped. Fixes two R1-adjacent issues but is itself unaudited. |
| **024** multi-protocol vaults | `vault_registry` (migration 0026), Fee Wrapper posture | In flight on a sibling branch. |

**Specific seams worth an adversarial pass** (from doing 023, not from a template):

1. **The S2S / `X-Owner` trust boundary** — R1's third medium, still open. The agent takes identity
   from headers the web tier asserts. Everything downstream (portfolio scoping, mandate ownership,
   `/session-keys` listing, the idempotency `account` component) rests on that. If the S2S token
   leaks, the whole scoping model is forgeable.
2. **The client-held session key** — encrypted in IndexedDB under a key derived from a
   one-time-per-session wallet signature. Threat-model the browser: XSS, a malicious extension, a
   shared device. The on-chain scope bounds the damage by design; confirm that bound is really tight.
3. **`submit_signed`'s byte-match** — it matches `sender` + `callData` only. Gas fields are inside the
   `userOpHash` so they cannot change post-signature, but confirm no other field is smuggle-able.
4. **The knowledge → prose boundary** — retrieved corpus text is fenced as advisory and reaches only
   prose agents. Prompt-injection is contained by structure (the LLM cannot build an action), but the
   containment should be attacked rather than assumed.
5. **The two fail-open choices** — the idempotency store and the quota gate both admit on failure, by
   design (N2). Confirm neither can be *induced* to fail in order to bypass a limit.
6. **`policy/evaluate.py` + `policy/session.py` adversarially** — untouched by 023 and audited at R1,
   but they are the spine; re-attack them against the new callers.

---

## 6. Ordered plan

1. **Commit `docs/security/R1-findings.md`** from the artifact, with status per finding. *(Unblocks
   everything else; without it R2 re-discovers what R1 already found.)*
2. **Write `deploy-mainnet.yml`** with the SHA-pinned sign-off gate from §3. It can be written and
   merged *before* any audit exists — it will simply refuse to deploy, which is the correct default.
3. **Run T103 (contracts)** — P0 five first. Produce one sign-off file per contract at its pinned SHA.
4. **Run R2 (app layer)** against `develop` post-023, seeded with §5's seam list and R1's round-2 list.
5. **Record both** in `gate-c-decisions.md`, then Gate C becomes a human go/no-go rather than an
   open question.

**Contract prerequisites, unchanged and independent:** the mainnet vault, the fee Safe and the
timelock must exist before any deploy gate matters. The AA stack is Base-Sepolia-only today.

---

## 7. What this document is not

It is not the audit, and it does not clear anything. Gate C is **never autonomous**
([`GATES.md`](./GATES.md)) and both audits require a human sign-off that no agent may issue.
