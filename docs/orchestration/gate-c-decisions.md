# Gate C — recorded operator decisions

Gate C (mainnet) requires the recorded internal security audit + hardening sign-off (T103) and is
**never autonomous** ([`GATES.md`](./GATES.md)). This file is the register of the *operator decisions*
that gate depends on — the ones that are policy calls rather than engineering work, recorded so they
are explicit rather than inherited by default.

Each entry states what was decided, by whom, when, and — importantly — **what it costs**, so a later
reader can tell a considered trade-off from an oversight.

---

## D-GC-01 · Launch caps ratified as-is

**Decided 2026-07-30 by the operator (aldrickb).** The existing cap set carries to mainnet unchanged.

| Cap | Value | Ceiling |
|---|---|---|
| Per-user TVL | 5,000 USDC | 10,000 USDC |
| Total protocol | 1,000,000 USDC | 5,000,000 USDC |
| Vault deposit | 1,000,000 USDC | 5,000,000 USDC |
| Session per-tx | 500 USDC | — (a grant may only narrow, §6.4) |
| Session cumulative | 5,000 USDC | — |
| Max session duration | 30 days | — |
| Slippage | user max 50 bps | floor 50, absolute ceiling 300 |

**Why now.** These live in `policy/constants.py`, mirrored to `packages/shared/src/policy/constants.ts`
with a CI parity gate. Changing them after launch is a `POLICY_VERSION` bump, so the decision had to be
taken *before* real funds, not discovered afterwards.

**Why as-is.** They are already conservative for the launch posture the constitution requires
(Principle V + the beta-gating workflow rule): a closed alpha behind a wallet allowlist, strict
per-user and total caps, kill-switch armed, geo-fenced frontend. Nothing about moving from testnet to
mainnet makes these numbers *less* appropriate.

**What it costs / accepted risk.** The first mainnet cohort can each hold up to 5,000 USDC, and the
vault up to 1,000,000, from day one — there is no smaller opening step. The mitigation is the
allowlist (cohort size is the real control) plus the pause kill-switch, which can stop new inflow
without ever blocking a withdrawal (N2). A lower first-cohort set was considered and declined as
unnecessary given that the allowlist already bounds exposure.

**Revisit trigger.** Any change is a `POLICY_VERSION` bump + a TS-mirror update + the parity gate, so
it is inherently visible. No silent drift is possible.

---

## D-GC-02 · The web swap path is explicitly out-of-policy

**Decided 2026-07-30 by the operator (aldrickb).** The user-signed Uniswap V3 swap path on the web
stays **outside** the deterministic policy layer, by decision rather than by omission.

**What is actually true today** (verified in code, not assumed):

- `SLIPPAGE.applies_to` is `(AERODROME_SWAP,)` only — the policy layer's slippage/min-out machinery
  covers the Aerodrome action type and nothing else.
- The assistant **cannot build a swap**. `_YIELD_STRATEGIES` contains only vault deposit and Aave
  supply; a swap intent on a Swap-page chain surfaces the web's own inline card as an `action` block
  deliberately stamped **`rejected`**, with the reason "Swaps run on Uniswap V3 — the assistant
  doesn't build them; you review the quote and sign."
- The swap therefore executes on the **web's own** wagmi/Uniswap path, user-signed, never through
  `/build-tx` and never through `policy.evaluate()`.
- The agent's 0.20% fee indexer only *observes* router fee `Transfer`s after the fact
  (`swap_fee_events`); it is not on the execution path.

**Why this is the ruling.** It matches what the code already does and what the UI already says. The
non-custody invariants are unaffected: the swap is user-signed from the user's own wallet, the service
holds no key, and nothing about the swap path touches the vault, the exit path (N2), or any
SparkPoint-controlled recipient (N1). Bringing swaps under the gate is a real feature — it needs a
fresh price simulation to be signable at all, which would make the fork simulator a hard readiness
dependency on any swap-capable chain — and it is not required for the vault-first launch.

**What it costs / accepted risk.** A user can execute a swap with slippage bounded only by the web
client's own default (50 bps preset, user-adjustable), with no server-side policy verdict and no
deterministic min-out floor. A compromised or modified client could widen its own slippage. This is
the second of the two mediums left open by alpha security audit **R1** ("chat-swap slippage
unbounded"); it is hereby **closed as accepted**, not fixed.

**Obligations this decision creates:**

1. The UI must keep saying so plainly — the `rejected` stamp and the "you review the quote and sign"
   copy are load-bearing disclosure, not decoration, and must not be softened.
2. The Trust Center should state that swaps are user-signed and outside the policy gate, so
   non-custody stays *provable* rather than merely true (Principle III / N5).
3. T103 should record it as an accepted risk with this rationale, so the audit does not re-raise it as
   a novel finding.

**Revisit trigger.** If a swap ever becomes agent-buildable, or if a swap is ever routed through
`/build-tx`, this decision is void and the gate must cover it.

---

## Still open (not decided here)

These remain Gate-C-adjacent and undecided; they are engineering scope, not policy calls:

- **T103 itself** — the recorded internal security audit + hardening sign-off. Readiness, scope and an
  ordered plan are now in [`t103-audit-readiness.md`](./t103-audit-readiness.md). ⚠️ That prep found
  T103 is narrower than the shorthand suggests: it is the **contract** audit plus a mainnet deploy gate
  (which **does not exist yet** — there is no `deploy-mainnet.yml`). The **app-layer** audit is a
  separate, also-required piece ("R2"): the execution spine (019), session keys (022), the bundler
  relay and 023 all landed **after** R1, so the most custody-adjacent code in the service has never
  been audited. It also found that **R1's findings were never committed to the repo**, so its 3 mediums
  cannot be tracked and its round-2 seam list is unavailable to whoever runs R2.
- **Mainnet deployment shape** — `SPARKPOINT_VAULT_ADDRESS` is singular and `for_chain` nulls the
  vault off-chain, so one instance cannot serve both the Sepolia and mainnet vaults. Feature 024's
  `vault_registry` (migration 0026) may supersede this question.
- **Contract prerequisites** — the mainnet vault, the fee Safe and the timelock must exist before any
  of the above matters.
- **Bundler URL split** — `rpc_url` currently doubles as the bundler URL because Alchemy serves both.
- **Hardcoded `84532`s outside the agent config** — `admin_revenue` network labels, premium/SRK chain
  pinning, the web's `VAULT_CHAIN`.
