# Mainnet readiness — the single register

**Maintained as the entry point for anyone preparing SparkPoint for Base mainnet.** Last swept
**2026-07-31** against `develop@21ece87`.

If you are a fresh agent or engineer picking this up: **read this file first, then only the linked
detail you actually need.** Everything blocking mainnet is listed here with a status and a pointer.
Nothing blocking is recorded *only* somewhere else.

---

## 0. Two corrections you need before you read anything older

**(a) Gate B is PASSED, not WAITING.** `GATES.md` carried "Gate B — WAITING" until 2026-07-31 while
`wave-state.json` — which `CLAUDE.md` names as the authoritative live state — has recorded **PASSED
since 2026-07-14**, with the withdraw-always drill physically performed (deposit 100 USDC → Aave,
pause via timelock, redeem 100.000001 USDC while `paused() == true`, tx `0x6190b6cf…07a0`). The stale
line also referenced a "**§09 GO checklist**" that **exists nowhere in this repo** — do not go looking
for it. Both are corrected; this note stays so the next reader of an old branch is not misled.

**(b) When two "authoritative" sources disagree, `wave-state.json` wins.** It is the machine state the
driver loop writes; `GATES.md` is a human log that can drift. That is now stated in both files.

---

## 1. The critical path

```
Gate A ─── APPROVED (2026-07-13)
Gate B ─── PASSED   (2026-07-14)   vault live on Base Sepolia; withdraw-always drill done
Gate C ─── WAITING  ← everything below blocks this. NEVER autonomous: a human signs off.
```

Gate C needs **four independent things**, none of which are done. They can run in parallel:

| | Blocker | Status | Detail |
|---|---|---|---|
| **C1** | Contract audit + hardening sign-off (**T103**) | not started | [`t103-audit-readiness.md`](./t103-audit-readiness.md) |
| **C2** | `deploy-mainnet.yml` — the gate that refuses to broadcast without a sign-off | **does not exist** | [`t103-audit-readiness.md`](./t103-audit-readiness.md) §3 |
| **C3** | App-layer audit (**R2**) | not started | [`../security/R1-findings.md`](../security/R1-findings.md) round-2 seams |
| **C4** | On-chain prerequisites: mainnet vault, fee Safe, guardian hardening | not started | §4 below |

---

## 2. Open security findings (verified in source 2026-07-31)

Full register with evidence: [`../security/R1-findings.md`](../security/R1-findings.md).
**R1 was 2026-07-21.** Its 3 mediums: two fixed, one open.

| Id | Finding | Severity | Status |
|---|---|---|---|
| **M3** | S2S bearer + `X-Owner` trusted **format-only** — no crypto binding between token and owner | medium | **OPEN — highest value.** Chosen approach: a **signed short-lived owner assertion** the agent verifies itself. Spans web + agent; needs a signing-key/rotation decision. Also closes **L3**. |
| L1 | SIWE nonce not server-side single-use ⇒ captured signed message replayable within expiry | low | open |
| L3 | `X-Chain-Id` client-controlled, unbound to the SIWE chain | low | open — **fold into M3** (bind owner *and* chain in one assertion) |
| L8 | Runtime image installs unversioned package **names**, never reads `uv.lock`; containers run as **root** | low, **re-rated** | open — supply-chain/reproducibility gap, not a pinning nit. Proposed fix in the register. |
| info#5 | General `VaultUnavailable` message interpolates transport text ⇒ may leak a keyed RPC URL | info | open, cheap |
| L6b | BIP-39 mnemonic detection in the PII denylist | low | **deliberately deferred** — a structural matcher was written and **rejected** because it flagged ordinary prose. Needs the vendored wordlist. Do not re-add naively; a regression test pins it. |

**Closed, do not re-litigate:** M1 (chat-swap slippage — fixed 2026-07-30, PR #117), M2 (idempotency
scope — fixed by 023), L2 (stale admin role — `require_admin` does a live DB check per request), L5
(rate limits — feature 008), L4 (`Secure` flag — not a defect on `http://`), L7 (open redirect — fixed
in the sweep).

---

## 3. Decisions already taken — do not re-open without the operator

Recorded in [`gate-c-decisions.md`](./gate-c-decisions.md):

- **D-GC-01** — launch caps ratified **as-is** for mainnet (5,000/user · 1M vault · 500/tx · 5,000
  lifetime session · 30-day max · 50 bps slippage). Changing them is a `POLICY_VERSION` bump plus the
  TS-mirror parity gate.
- **D-GC-02** — the web Uniswap swap path stays **outside** `policy.evaluate()`, user-signed. The
  ruling stands; its original risk description was **corrected** after the slippage bug was found. It
  creates three live obligations, one of which is **unowned**: the Trust Center should state that
  swaps are user-signed and outside the policy gate.

---

## 4. On-chain prerequisites (C4)

Nothing SparkPoint-owned exists on Base mainnet today. Before any deploy gate matters:

- **The vault** — a mainnet `SparkPointVault` (or, per constitution v3.0.0, a **Morpho Vault V2 Fee
  Wrapper**; `SparkPointMorphoVault` is *superseded for new deployments*). Feature 024 owns this area.
- **The fee treasury Safe** — a mainnet 2-of-3 (the Sepolia one is `0xCB13…578f`).
- **Guardian hardening** — Gate B deliberately deferred this: today the deployer EOA is sole
  proposer/executor/admin on the timelock at a 60s delay. Mainnet needs **Safe M-of-N + a 2-day delay
  + renounce admin**. This is R1 **info #2** as well, and it is a genuine mainnet blocker rather than
  a nicety.
- **The AA stack** (`SparkPointAccount`, `AccountFactory`, `SessionKeyValidator`, `PolicyModule`) —
  Base-Sepolia-only today.

---

## 5. Config that must change for mainnet (feature 023 made these explicit)

- **`CHAIN_ID=8453` now REQUIRES an explicit mainnet RPC** — `SPARKPOINT_RPC_URL` or
  `BASE_MAINNET_RPC_URL`. There is **no fallback** to the fork or to Sepolia, in either direction. An
  unconfigured chain fails closed and names the vars to set.
- **The RPC must prove its chain.** The agent asserts `eth_chainId == CHAIN_ID`; a MISMATCH **latches**
  the chain-dependent surface closed until the config is fixed *and the process restarts*.
- **`/readyz` changed shape** — `chain_rpc` + `chain_identity` + `chain_id` replace `base_rpc`. Anything
  parsing that response needs updating.
- **Run ONE uvicorn worker.** The LLM concurrency limiter is per-process; N workers ⇒ N× the intended
  cap. Cost/rate limits only, no custody impact — the agent warns rather than refusing to boot.
- **Migrations:** production is at **`none`**. All of `0001`→`0027`+ must be applied, in order, with
  `PGCLIENTENCODING=UTF8`, **before** the first agent boot. See [`../../MIGRATIONS.md`](../../MIGRATIONS.md).
- **A mainnet agent is a SEPARATE deployment.** `SPARKPOINT_VAULT_ADDRESS` is singular and `for_chain`
  nulls the vault off-chain, so one instance cannot serve both Sepolia and mainnet vaults. *(Feature
  024's `vault_registry`, migration 0026, may supersede this — check with that workstream.)*

Full env contract: [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 6. Known-deferred, not blocking, but do not "discover" them as new

- **Robinhood Chain 4663** — ratified in constitution v3.0.0 but **not** in
  `policy.SUPPORTED_CHAIN_IDS`. `_CHAIN_RPC_ENVS` deliberately has no row; a ⚠️ comment there says so.
  Overlaps feature 024 — coordinate, don't race.
- **Bundler URL split** — `rpc_url` doubles as the bundler URL because Alchemy serves both.
- **Hardcoded `84532`s outside the agent config** — `admin_revenue` network labels, premium/SRK chain
  pinning, the web's `VAULT_CHAIN`.
- **Committed dev-slug CORS default** in `api/main.py`.
- **The superseded coordinator scaffolding** (`coordinator/{coordinator,flows,agentic_loop}.py`) is
  retained-and-marked, not dead by accident. A test enforces the marker. `execution/orchestrate.py` is
  the live interposition.

---

## 7. Traps that will cost you time (learned the hard way)

- **Migration numbers collide across parallel agents.** 023 and 024 both authored `0026`; 023's was
  already applied to the shared develop DB. Check sibling worktrees' `services/agent/migrations/` **and**
  `origin/develop` before authoring one. Recovery = rename the file, `DELETE FROM _yoyo_migration
  WHERE migration_id='<old>'`, re-apply, record the renumber.
- **`yoyo apply --batch` applies EVERY pending migration**, including another feature's. It silently
  applied 024's `0026_vault_registry`. Tell the other workstream rather than letting them find out.
- **`content_seed/whats-new.json` merge conflicts land mid-object**, so a naive keep-both resolution
  produces *legal JSON that silently drops an entry*. Rebuild both objects and assert both slugs survive.
- **The `changelog-required` gate ignores `[skip changelog]`** for any PR touching `apps/web/src` or
  `services/agent/src`. Both changelogs are mandatory there.
- **CI runs on the OH Defender self-hosted fleet** (`runs-on: [self-hosted, oh-ci]`). A branch that
  predates that move fails in ~2s with 0 steps — that is a stale runner config, not your code. Merge
  develop.
- **Coolify token env names**: there is no bare `COOLIFY_API_TOKEN`. Use
  `COOLIFY_API_TOKEN_READ_READSENSITIVE` (reads, including an app's env **values** — this is how to get
  `AGENT_S2S_TOKEN`) and `COOLIFY_API_TOKEN_RWD` (for `POST /api/v1/deploy`).
- **Verify a deploy via the deployment record**, never the status badge (see `COOLIFY.md`).
- **Spec numbers are contended too** — check sibling worktrees for uncommitted `specs/NNN-*` before
  claiming one.

---

## 8. What "ready for mainnet" actually requires

A human signs off. No agent may clear Gate C. Concretely:

1. C4 on-chain prerequisites exist (vault, Safe, hardened guardian).
2. C1 contract audit complete, with a sign-off file per contract at its pinned source SHA.
3. C2 `deploy-mainnet.yml` merged and demonstrably refusing to deploy without those files.
4. C3 R2 complete, with findings triaged and the mediums closed or explicitly accepted in
   `gate-c-decisions.md`.
5. M3 closed (or accepted in writing — it is the one open medium).
6. Production DB migrated and the mainnet env contract satisfied (§5).
7. Operator sign-off recorded in `GATES.md` **and** `wave-state.json`.
