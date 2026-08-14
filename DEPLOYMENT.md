# Deployment — SparkPoint Pivot

How SparkPoint Pivot ships. Platform specifics in [COOLIFY.md](./COOLIFY.md); local dev in [DEVELOPMENT.md](./DEVELOPMENT.md); migration history in [MIGRATIONS.md](./MIGRATIONS.md).

> **Status (updated 2026-07-16 — P0/P1/P1.5 develop deploy).** The **web app AND the Hermes agent service are now BOTH deployed on OH Coolify `develop`**, wired via a same-origin BFF, serving the full app (US1 vault live + US3–US5 assistant):
> - **web (develop):** `sparkpoint-web` (UUID `i4cw0ogsookkkocsw808gwc4`) at **`https://71zxh8ed1ejf8132l46joodp17.aldrickb.app`** (+ alias `https://71zxh8ed1ejf8132l46joodp17.obrahaus-develop.aldrickb.xyz`). **`SITE_LOCKED=false`** — the full app is exposed on this long, hard-to-guess slug (the old `i4cw0ogsookkkocsw808gwc4.aldrickb.app` develop domain is retired).
> - **agent (develop):** `sparkpoint-agent-develop` (UUID `fw8s4ko4080wgk8okso8go48`), FastAPI on `:8000` at `8jcvimzny63tw81xkfl3wwmdzz.aldrickb.app`. It has a **public FQDN** (Coolify/Traefik routes by domain) but is **hardened**: `/docs`+`/openapi.json` disabled, `/readyz` leaks nothing to anonymous callers, and every functional route is behind a fail-closed S2S bearer that ONLY the web BFF holds (server-side). The browser NEVER calls it directly — it goes through the same-origin BFF at `/api/agent/*`. Both apps sit on the shared Coolify network; moving the BFF→agent hop to internal-only DNS + dropping the agent's public FQDN is a documented follow-up.
> - **DB:** `spark-postgres` (existing) — migrations 0002/0003/0004 applied; the agent connects the asyncpg pool at startup.
>
> **⚠️ MAINNET ENV CONTRACT (feature 023) — read before standing up an 8453 deployment.**
> - **`CHAIN_ID=8453` REQUIRES an explicit mainnet RPC** — `SPARKPOINT_RPC_URL` or the new
>   `BASE_MAINNET_RPC_URL`. There is **no fallback** to `SIM_FORK_RPC_URL` or `BASE_SEPOLIA_RPC_URL`
>   any more, in either direction. Before 023 a missing var silently served fork or Sepolia state as
>   mainnet, which (because cap headroom/`paused()`/`totalAssets()` feed the policy gate while the
>   calldata targets the mainnet vault) could produce a bundle **approved against one chain's state and
>   signed on another**. An unconfigured chain now fails closed and names the vars to set.
> - **The RPC must prove its chain.** The agent asserts `eth_chainId == CHAIN_ID` (cached ~60s). A
>   MISMATCH **latches**: the chain-dependent surface (vault quotes/simulations, portfolio, outcomes,
>   build/simulate/submit, session-keys) fails closed until the config is fixed **and the process
>   restarts**. `/healthz`, chat, the advisory reads and `/admin/*` keep serving, and the frontend's
>   direct-RPC exit is untouched (N2). This catches **misconfiguration**, not a hostile RPC.
> - **`/readyz` is chain-aware.** `chain_rpc` + `chain_identity` replace `base_rpc`; `sim_fork` only
>   counts toward `ready` on a chain whose allowlist offers a swap. An S2S caller also gets `chain_id`
>   — useful for telling a mis-pointed deployment from a down dependency. The RPC url is never in the
>   response or any log line (it can carry a provider key).
> - **Migration order is load-bearing:** apply **`0027`** BEFORE redeploying the agent. The idempotency
>   store fails open, so the reverse order runs with no replay protection, no error and no failing
>   check (the agent logs a distinct `idempotency_table_missing` warning as the backstop). `0027` is
>   additive, so applying it first is safe for the live agent.
> - **RUN ONE UVICORN WORKER.** The process-global LLM concurrency limiter (`llm/resilience.py`) is
>   per-process: with N workers the effective in-flight cap is N× the intended one. This affects
>   **cost and upstream rate limits only** — no custody impact, and the LiteLLM virtual key caps
>   rpm/tpm/daily budget server-side as well — so the agent WARNS at boot rather than refusing to
>   start when `WEB_CONCURRENCY`/`UVICORN_WORKERS` > 1. Externalizing the limiter is the follow-up if
>   horizontal scaling is ever needed.

> **LLM path (Phase A, 2026-07-16):** Hermes no longer calls Anthropic directly — it calls an OpenAI-compatible **LiteLLM gateway → OpenRouter** (`sparkpoint-litellm-develop`, alias `sparkpoint-chat`), backed by a **dedicated, isolated Postgres** (`sparkpoint-litellm-db-develop`, NOT spark-postgres). Only the gateway holds the OpenRouter key; the agent uses a per-service **virtual key** (rpm/tpm + daily budget). `readyz` probes the gateway liveness (the `llm` check). The Anthropic-OAuth path stays as an env-selected fallback. Full gateway inventory + secrets policy in [COOLIFY.md](./COOLIFY.md).
>
> Prior status (2026-07-10, superseded): web deployed, backend/agent/DB "planned". Full app inventory + UUIDs in [COOLIFY.md](./COOLIFY.md).

> **Client-project note.** SparkPoint Pivot is an **ObraHaus client product**, *not* part of the ObraHaus Apps Ecosystem. It is in the ObraHaus GitHub org for now; ownership may move to the client later. Sanctioned divergences from the playbook: **wallet auth** (Wagmi / WalletConnect / Coinbase Wallet) instead of obrahaus-console SSO; AI called **directly** (Anthropic / OpenAI-compatible API, or a future own gateway) instead of obrahaus-governor; **own brand** (cobalt / gold / coral) instead of the OH Primary design system. The branch flow, PR security gate, and Coolify deploy/verify conventions still apply.

## Environments

| Environment | Public URL | Git branch | Hosting | DB | Auth cookie / session |
|---|---|---|---|---|---|
| **Prod · public landing (live now)** | **https://sparkpoint.io** | `main` | **OH Coolify** — `sparkpoint-web-primary`/`-secondary` + LB `sparkpoint-web-lb`; `SITE_LOCKED=true` (landing-only) | — (no DB yet) | wallet session |
| **Production (final hosting, later)** | `https://sparkpoint.io` (domain already live) | `main` | **Client's own infra** (TBD; the domain stays, hosting may move off OH Coolify) | Postgres + pgvector (client-managed, TBD) | wallet session (SIWE-style); no shared cookie |
| **Develop / staging (live)** | **http://i4cw0ogsookkkocsw808gwc4.aldrickb.app** | `develop` | **OH Coolify** — `sparkpoint-web` (single instance) | Postgres + pgvector on Coolify (planned) | wallet session |
| **Local** | http://localhost:3000 | working branch | Coder workspace | local Postgres+pgvector / Coolify develop DB | wallet session (unset cookie domain) |

- **Current phase:** the **public landing runs on OH Coolify** off `main` (gated `SITE_LOCKED=true`), now served at the **client domain `https://sparkpoint.io`** (pointed at the OH Coolify LB on 2026-07-10; the former Coolify auto-domain `h8cggk088co8k4400sgwcsww.aldrickb.app` is **retired → 404**). Moving the **hosting** to the client's own infra (keeping `sparkpoint.io`) may still follow — **TBD** with the client handoff. Dev/staging uses OH Coolify per the playbook topology.
- **Develop is intentionally gated too (2026-07-10):** the develop app has **no `SITE_LOCKED` set** → fail-closed = landing-only, *by design* while in development — the full app isn't exposed on any environment yet. Flip `SITE_LOCKED=false` + `NEXT_PUBLIC_SITE_LOCKED=false` on `sparkpoint-web` (develop) + redeploy when a shared full-app preview is wanted (see [COOLIFY.md](./COOLIFY.md)).
- All app domains in Coolify use the **`http://` scheme** (TLS is terminated upstream — see COOLIFY.md). New subdomains must exist in Cloudflare DNS + the nginx reverse proxy.

## Planned services

These get created in Coolify when the build starts (see COOLIFY.md for ports/inventory) — **none are deployed yet**:

- **Web app** (Next.js App Router) — primary + secondary behind the nginx load balancer.
- **Agent service** (OpenClaw / Hermes, self-hosted Docker) — Claude reasoning behind the deterministic policy layer.
- **Postgres + pgvector** — single instance (no LB).
- _Smart contracts (Foundry, Base — ERC-4337 + ERC-4626) deploy to **Base**, not Coolify; chain deploys are a separate runbook authored at build time._

## How deploys happen

Self-hosted **Coolify** (Nixpacks) for dev/staging. **Auto-deploy on push**: `develop` → develop apps. Production deploys go to the **client's infra** (mechanism TBD; document here once the client handoff is scoped — could be Coolify on client infra, the client's own CI, or another platform).

- ⚠️ Merging to `main` is intended to trigger production — **apply DB migrations to prod BEFORE merging** (see MIGRATIONS.md).
- 🚫 **No production deploys on Fridays** (PH / Asia-Manila). Production deploys are **batched** on a deliberate, non-Friday date — not automatically the same day a PR merges.

> **Construction gate (current phase).** The first public deploy is **landing-only**: the `main` build runs with `SITE_LOCKED=true`, so only the marketing landing (`/`) is reachable and every other route redirects to a `noindex` `/coming-soon` page. `develop` runs `SITE_LOCKED=false` (full app) for team/client preview — same artifact, config-only difference (see [COOLIFY.md](./COOLIFY.md) → "Construction gate"). **Launch (un-gate):** set `SITE_LOCKED=false` **and** `NEXT_PUBLIC_SITE_LOCKED=false` on the public app and redeploy — no code change, no revert. The gate is **fail-closed** (unset ⇒ locked), so never rely on omitting the var to open the site. Spec Kit feature `specs/003-landing-only-gate/`.

### Feature 006 — force-refresh + What's New (flag-gated): how to deploy

The web app can auto-reload stale tabs onto a new deploy and greet users with what changed. It **ships flag-off** (`NEXT_PUBLIC_FORCE_REFRESH` unset → dormant, zero user impact) and is safe by construction: it **never** reloads while a signature or a broadcast-but-unconfirmed tx is in flight, or on the `/exit`/`/trust` escape hatches (N2). Spec Kit: `specs/006-force-refresh-whats-new/`.

> **This exact sequence was executed + verified on `develop` 2026-07-20** (PRs #43 + #44). **Prod is the same, applied to BOTH LB replicas.**

**Staged rollout — deploy dark → verify → flip:**

1. **Deploy the code, dark.** Merge to the target branch → Coolify auto-deploys web + agent with the flag OFF. Nothing user-visible changes yet.
2. **Apply migration `0014_content_slug`** to that env's DB, **before the agent boots** (yoyo, `PGCLIENTENCODING=UTF8` — see [MIGRATIONS.md](./MIGRATIONS.md)). ⚠️ If the agent already booted, its changelog boot-loader logs `whats_new_upsert_failed` (missing `slug` column, fail-open) — **restart the agent** (`POST /api/v1/applications/{uuid}/restart`) to re-ingest.
3. **Verify dark:** `GET /api/version` returns JSON + `Cache-Control: no-store` with the per-build id; the app loads; the seed ingested (DB has rows with a `slug`; `/content/changelog` active count == `whats-new.json` active count).
4. **Flip the flag:** set `NEXT_PUBLIC_FORCE_REFRESH=true` in the web app's **build** env, then **redeploy the web app**. Confirm the client bundle inlines `NEXT_PUBLIC_FORCE_REFRESH:"true"`.
5. **Activate the 006 announcement:** flip its `content_seed/whats-new.json` entry to `active: true` (a content PR) → agent re-ingest.

**Coolify gotchas (learned on develop — identical on prod):**
- **Version id is automatic — nothing to bump.** `next.config.ts` builds `<SOURCE_COMMIT>-<build timestamp>`. Coolify **does** expose `SOURCE_COMMIT` to the Nixpacks build here, so `/api/version` returns the real commit SHA + a per-build timestamp; it changes on every deploy even with no config. (The `build_command` `git rev-parse` fallback returns empty in the Nixpacks context, but `SOURCE_COMMIT` covers it — so the earlier "wire the build SHA" step is effectively already done.)
- **`NEXT_PUBLIC_FORCE_REFRESH` is build-time-inlined** → set the env **then** redeploy. A deploy triggered *before* the env is set builds dark (wasted rebuild). The env-create API on `4.0.0-beta.434` **rejects `is_build_time`** — POST `{key,value}` only (Coolify defaults new vars to build + runtime, which is what we need).
- **Prod = primary + secondary + nginx LB** ([specs/003-landing-only-gate/deploy-runbook.md](./specs/003-landing-only-gate/deploy-runbook.md)). Set the flag env on **BOTH replicas** and redeploy both, exactly like `SITE_LOCKED` — a flag on one replica only sends ~half the users (`ip_hash`) to a dark build.
- **`content_seed` must be COPYed in the agent Dockerfile** (it is) or the loader ingests 0. **Trust the deployment record** (`status: finished`), not the health badge (see COOLIFY.md).
- **⚠️ Editing `knowledge_seed/` does NOT take effect on a redeploy.** The RAG corpus is ingested by an explicit one-shot step, never at boot (`ingest_cli` deliberately keeps embedding off the request path). A deploy therefore ships the new markdown into the image and the assistant still answers from the OLD corpus, silently — `/admin/knowledge` shows the stale source count and nothing errors. **After any `knowledge_seed` change, run the reingest**: `POST /admin/knowledge/reingest` (admin-gated), or from a checkout with `DATABASE_URL` + `EMBEDDING_OPENAI_*` in the env, `uv run python -m sparkpoint_agent.knowledge.ingest_cli`. It is idempotent (deterministic chunk UUID5s, stale chunks pruned). Verify by the source count: 029 took the corpus from 6 sources / 25 chunks to 9 / 44, and `knowledge_notes` (admin overrides) must be checked first — an admin-edited note of the same slug wins over the shipped seed. The same one-shot rule applies to `knowledge_seed_tips` (`/admin/tips/reingest`). **`content_seed` is different** — `_seed_changelog` runs it at boot, so a `whats-new.json` entry IS live straight after a redeploy. Embedding is what makes the difference: the corpora that need a vector are kept off the boot path.

**Rollback:** set `NEXT_PUBLIC_FORCE_REFRESH=false` (or delete the var) + redeploy → fully dark again, no code revert. The migration + seed are additive and can stay.

## Branch flow & PR gates

```
feature/* ──PR──▶ develop ──(batched, non-Friday)──▶ main (prod)
```

Every PR must pass the **OH Defender** security scan before merge (SCA / secrets / SAST; replaces CodeRabbit + Snyk). Check its Check Run gate:
```bash
gh pr checks <PR> -R ObraHaus/sparkpoint-pivot --json name,bucket \
  | jq -e 'all(.[] | select(.name|test("defender";"i")); .bucket=="pass")' && echo "OH Defender gate: PASS"
```
Resolve any findings in the Defender console / via its MCP server before merging. (Until this repo is wired to Defender, legacy CodeRabbit + Snyk checks remain in force.)

> **Smart-contract gates (planned).** When contracts land, PRs touching `contracts/` should additionally be green on `forge test`, gas snapshots, and Tenderly simulation, and follow the non-custody invariant checks from the constitution (N1–N5). Audited contract addresses are recorded in the release notes when deployed to Base.

### Base Sepolia on-chain record — feature 012/014 (2026-07-22)

- **SRK test token** (`SparkPointTestToken`): `0x2dF90304126560F01Dd6EafB508B69c033dFeD52` — deploy tx `0x94459d7a789b466c3d55d10497c10ca2bf62bad6cd684737adf8d8aa3321a504` (fixed 1e9 supply → deployer; no mint/faucet).
- **Fee-treasury Safe** (Gnosis Safe v1.4.1, 2-of-3): `0xCB135893C84876aab9E10792b56e5bEa91dc578f` — deploy tx `0x014bd9d2ec9607ee7d3b305e489f84d3a468ee57b7cdf55fab96c9c9f0d3bf56`. Owners: deployer `0xA71e…5c30` + `0x867E…5fEb` + `0x122D…05Ed`; threshold 2. Signer keys in `.claude/testnet-wallets.txt` (testnet only).
- **Fee-recipient cutover** (Timelock `0x0A21…d720`, `setFeeRecipient(Safe)`): schedule tx `0x99c737d4beebde52bbe65a90cfeb2c9832b3292904510770ef492e975f9b3c1b` → (60s delay) → execute tx `0x9d38d4e789917756ccee45a8510dcf901fa7d14e15c92522781ed740b089bac8`. `vault.feeRecipient()` == the Safe (perf fee + Base swap fee now route to the multisig).

### SRK faucet — feature 026 (2026-08-02)

Testers need SRK to exercise the Premium purchase, but `SparkPointTestToken` has a **fixed supply, no mint function and no owner** (a spec-012 property with a fuzz test asserting it), so the token was **not touched**. A standalone dispenser holding a hand-transferred float was deployed instead.

- **`SrkFaucet`**: `0x93766a1C6c2076F658710770549af34Ac46dB2a9` — deploy tx `0x83c82c18c81df7ade6fc62851f0e8f8ca6437b61a422ca326f975827dfcfaa13` (block 44953705), [verified on Basescan](https://sepolia.basescan.org/address/0x93766a1c6c2076f658710770549af34ac46db2a9#code).
- **Float**: 10,000,000 SRK transferred from the deployer — fund tx `0x98af2d6409504cbb914a8cf9f83abce1bcfc0fdab7b50e1e53d0346606cc63d3` (block 44953706). At 5,000 SRK/claim that is **2,000 claims**.
- **Parameters** (verified on-chain after deploy): `token` = SRK `0x2dF9…D52`, `claimAmount` = `5000e18`, `cooldown` = `86400` (24h, per address), `owner` = deployer `0xA71e…5c30`.
- **Admins**: deployer + the client demo wallet `0x32Ed4400C5BBB394712c482F1207886d8C22e8b5`. Owner **or** an admin may `setClaimAmount` / `setCooldown`; only the owner may `withdraw` the float, manage admins or transfer ownership. The agent is provably **keyless**, so "admin-editable from the panel" means the connected admin **wallet** signs these setters from `/admin/faucet` — no backend is in the trust path.
- Script: `contracts/script/DeploySrkFaucet.s.sol` (`--slow` is required — the deployer is a delegated EOA). Set `FAUCET_ADDRESS` to top the float up instead of deploying a new one. Recorded as `srkFaucet` in the Base Sepolia address book and `SrkFaucet` in `contracts/deployments/84532/addresses.json`.

### Agent env for the broker premium path — feature 043 (2026-08-14)

The agent resolves an activated broker as a source of Premium only once these are set. **Unset ⇒ it
behaves exactly as it did before 043** — the broker is simply not a premium source.

```
BROKER_CHAIN_RPC_URL      = <eRPC /core/evm/46630?secret=…>  (or the public Robinhood testnet RPC)
BROKER_NFT_ADDRESS        = 0x15D269B1D4fb3581E5a47482A70215e63Ed547f2
BROKER_REGISTRY_ADDRESS   = 0xD95067667E5ff2B1e898AF83063e8D2ca7D8D775,0x5370d06bFA9049234C471e0877e249D9322728FF
BROKER_GATE_CACHE_SECONDS = 60
```

> ⚠️⚠️ `BROKER_REGISTRY_ADDRESS` is a **comma-separated list, newest first, and nothing is ever
> removed from it.** Re-pointing the NFT's `activator` orphans every activation the previous registry
> recorded, and there is no on-chain recovery — the NFT still reports those tokens activated, so
> `activate` reverts and the record cannot be rebuilt. A holder who paid would silently stop
> qualifying. Reading the union is safe because the list is only ever a hint; the live `ownerOf` +
> `activatedAt` reads are the authority.

### Broker sale (the free, open mint) — feature 043 phase C (2026-08-14)

The NFT's `minter`, the second role left unset at deploy. **Free and open**: no price, no eligibility gate, no allowlist — an owner-settable per-wallet cap is the only restriction, and the collection's immutable 10,000 cap stays on the NFT rather than being re-implemented here.

- **`BrokerSale`**: `0x488268134af3d01E0672A9Ea17d529D4C5E275Dd`, `perWalletCap` 5, open at deploy, owner = deployer, `Ownable2Step`. Wired via `setMinter`.
- **Why free** — the mint was originally to be gated on holding ≥1,000,000 **mainnet** SRK, which is a cross-chain assertion no contract can make (the balance is on Ethereum, the contract is on Robinhood Chain). Every honest workaround is a different *trust model*, not a detail. The operator's decision to make the mint free deleted that question instead of approximating it. A price or an allowlist is additive later.
- **Proven live**: a free mint from a normal wallet (93,674 gas) produced broker #4 **unactivated** (I8); minting to the cap then one more reverted `WalletCapReached(0x32Ed…e8b5, 5, 5)` with no state change; the full journey mint → activate then retired 10,000 SRK and flipped #4 to activated.

> ⚠️ **A per-wallet cap is not a sybil defence and must not be described as one.** It bounds one address, and a free mint means a second address costs only gas. What actually bounds the collection is the NFT's immutable 10,000 supply cap — which a test exercises by exhausting the collection *through the sale* and asserting the next mint fails at the NFT, not at the sale.

> ⚠️ **`_safeMint` makes the per-wallet cap re-entrant-sensitive.** The NFT mints with `_safeMint`, so a CONTRACT recipient receives `onERC721Received` mid-mint and can call `mint()` again. The sale therefore increments `mintedBy` **before** the external call; incrementing after would let one contract mint the whole collection in a single transaction. There is a test that mints from a deliberately re-entering contract and asserts the cap holds.

### Broker activation registry — feature 043 phase B (2026-08-13)

The contract that retires SRK and activates a Sparky Broker in one user-signed transaction. It is the NFT's `activator` — the role deliberately left unset at deploy. It never holds a broker, never holds retired SRK, has no withdraw/sweep/rescue and **no `payable` function**, so nothing can be sent to it and nothing can be stranded in it.

- **`BrokerActivationRegistry`** (live): `0xD95067667E5ff2B1e898AF83063e8D2ca7D8D775` — deploy tx `0x9d79a545cfebb8c71fe96d2c89467d778dfabc95d7c91f281128ddfefdad9cd1` (block 100670158), wired via `setActivator`.
- **Superseded first deploy**: `0x5370d06bFA9049234C471e0877e249D9322728FF` — deploy tx `0xf0b6967345ffc33be5fb661f271513aa9c7c4909a660b42bdeacae521b13e362`, `setActivator` tx `0x05df05bc661f7e2a562824fb7498577ece42f09bee1f4f885456f991579ae8c8`. Replaced within the hour; see the ⚠️ below — **it must stay in the agent's registry list forever.**
- **Parameters**: `price` 10,000 SRK (owner-settable), `maxPrice` **100,000 SRK — IMMUTABLE**, `deadAddress` `0x…dEaD`, owner = deployer, `Ownable2Step`.
- **Proven live, not just deployed** — activation tx `0xa808e27c903c11fc45329bd006455d2be5921919e6fe09518d21a1d915a2fdb0` (143,901 gas): 10,000 SRK moved holder → dead address, `activatedAt(3)` set, the registry left holding **zero** SRK, zero ETH and no broker, and SRK's `totalSupply` unchanged — which is exactly why every surface says *retired*, never *burned*.
- **The atomicity property, live**: four failed activations in a row (already-activated ×2, not-the-owner, no-allowance) moved **not one wei**. There is no state in which SRK has left a holder and the broker is not activated.
- **The product rule, live**: sold #3 → activation cleared → the seller stopped qualifying for Premium AND the buyer did not inherit it; reacquiring it did **not** restore the activation, and re-activating cost another 10,000 SRK.

> ⚠️⚠️ **RE-POINTING `activator` ORPHANS EVERY PRIOR ACTIVATION — and there is no on-chain recovery.**
> Learned the hard way here: the first registry was replaced (a de-duplication fix), and every activation it had recorded instantly became invisible. The NFT still reports those tokens as activated, so `activate` reverts `AlreadyActivated` and the record cannot be rebuilt — a holder who had paid would silently stop qualifying for Premium.
>
> The fix lives off-chain, where it costs an env change rather than a redeploy: **`BROKER_REGISTRY_ADDRESS` is a comma-separated list, newest first, and the agent reads the union.** That is safe because the list is only ever a HINT — the live `ownerOf` + `activatedAt` reads are the authority, so merging hints cannot produce a wrong verdict.
>
> **Never remove a registry from that list.** Current value:
> `0xD95067667E5ff2B1e898AF83063e8D2ca7D8D775,0x5370d06bFA9049234C471e0877e249D9322728FF`

### SRK + faucet on Robinhood testnet — feature 043 phase 1 (2026-08-13)

The Sparky Broker NFT lives on **Robinhood Chain**, and activating a broker retires SRK. A burn on one chain cannot flip state on another in the same transaction, so the SRK a broker retires has to live on the broker's chain — that is what makes an atomic, backend-keyless activation registry possible. This is the same recipe as Base Sepolia, pointed at 46630.

- **`SparkPointTestToken`** (SRK on 46630): `0x4538B536b1da5940deC8e15048Ce07a053699B04` — deploy tx `0xd43899516ff772d868e9448da8700f80d8b42fd1f81c3fe270f76ebcb49acd35` (block 100514125). Fixed 1e9 supply → deployer; **no mint, no owner** (both selectors probed on-chain and revert).
- **`SrkFaucet`** on 46630: `0x39C38c86611FF3679802D5341E830c83DB7F4537` — deploy tx `0x48bf8afdc62740d2962ccb0dff0688810ac5ff3e9e60c6ebc96ab7ef34e1231c` (block 100514347).
- **Float**: 10,000,000 SRK — fund tx `0xaee0169745e779c91e15e65115ae5e8c1e093c626d404a20f5c8eb58372f1f4c` (block 100514358). 2,000 claims at 5,000 SRK each. Same parameters and same admin roster as Base Sepolia (deployer + the client demo wallet `0x32Ed…e8b5`).
- **Proven live, not just deployed**: a real user-signed `claim()` from the test wallet landed 5,000 SRK (tx `0xa5aca38d68c88bf4292936a3d0f542ef746a87318c39b5a09f421fb238e9cd1c`), dropping the float to 9,995,000 and `claimsRemaining` to 1,999; an immediate second claim reverted `CooldownActive(1786705379, 86390)`.
- Recorded as `srk` / `srkFaucet` in `packages/shared/src/addresses/robinhoodTestnet.ts` and in `contracts/deployments/46630/addresses.json`.

> ⚠️⚠️ **This SRK is a different token from the Base Sepolia SRK.** Same contract, same fixed supply, different chain and different address; balances do not carry across and must never be summed. **`premiumTreasury` is deliberately left unset on 46630** — `services/agent/.../chain/payment_verifier.py` is constructed with ONE `srk_address` and ONE RPC (`SRK_ADDRESS_84532`), so a Premium payment made on Robinhood could never be credited: money out, no Premium, no repair path. `/premium/pay` reads the address book for the **connected** chain, so the guard cannot be the absence of a field. `PREMIUM_SETTLEMENT_CHAIN_IDS` in `apps/web/src/lib/chain/premiumPay.ts` is the positive allowlist, and a unit test pins it. Adding a chain there is a claim that the verifier can settle it.

### Guardian → 2-of-3 Safe cutover — §6.2 multisig kill-switch (2026-07-24)

The vault's `guardian()` stays the OZ **TimelockController** `0x0A21…d720` (unchanged). Its control was moved off the single deployer EOA onto a **dedicated 2-of-3 Gnosis Safe**, and the deployer **fully renounced** — so no single key can pause/unpause or change fees/caps anymore; only 2-of-3 of the guardian signers can, after the 60s timelock delay.

- **Guardian Safe** (Gnosis Safe v1.4.1, 2-of-3, threshold 2): `0x1265f0ffFF933162719E2261E5b1242863543964`. Owners = 3 **dedicated** guardian signers `0xb24e…DB55` + `0xa1e8…D6Ff` + `0xF7aa…3426` (SEPARATE from the fee-treasury Safe — separation of duties). Signer keys in `.claude/testnet-wallets.txt` (testnet only; the originally-planned governance signers `0x08ea`/`0x23b6` were lost in a prior file clobber and replaced by these).
- **Roles granted** to the Safe on the timelock: `PROPOSER_ROLE`, `EXECUTOR_ROLE`, `CANCELLER_ROLE` (deployer, direct — deployer held `DEFAULT_ADMIN_ROLE`).
- **Proven before renounce** — the 2-of-3 Safe executed a full `pauseDeposits()` → (60s) → `unpauseDeposits()` round-trip via the timelock, restoring `paused()==false`, confirming the Safe truly controls the guardian.
- **Deployer full-renounce**: `renounceRole` for `PROPOSER`/`EXECUTOR`/`CANCELLER`/`DEFAULT_ADMIN`. **Verified on-chain**: deployer `hasRole == false` for all four; Safe `hasRole == true` for PROPOSER/EXECUTOR/CANCELLER. Irreversible — the vault's governance is now a pure 2-of-3 multisig. (User funds unaffected regardless: withdraw/redeem carry no pause modifier, N2.)
- Recorded in the address book as `governanceSafe` (Base Sepolia); surfaced on `/trust` (Guardian controller) and `/admin/killswitch` (2-of-3 · live). Ceremony script: `scratchpad/guardian-ceremony.cjs` (not committed; deploy/grant/test/renounce phases).

### Deterministic contract addresses (CREATE2)

`contracts/script/DeploySepolia.s.sol` deploys the core (`SparkPointVault` + `CapRegistry` + `KillSwitch` + `AaveV3Adapter` + `TimelockController`) via **`CREATE2` with a fixed salt** — `keccak256("sparkpoint-core-v1")`. The deployed address is a pure function of **(deployer, salt, init-code)**, so:

- **Redeploying the same bytecode + constructor args from the same deployer lands at the same address** — no address churn across redeploys, and the address is pre-computable (see `test/DeployDeterminism.t.sol`). This keeps `packages/shared` address books and Coolify env stable through a redeploy.
- The address **depends on the constructor args**, so a different Aave market / USDC / deployer correctly yields a *different* address (it is a genuinely different deployment).
- **CREATE2 changes only the deploy *method*, never the runtime bytecode** — the vault stays the exact test-suite build and remains **immutable + non-custodial** (N1/N5). It does **not** make any contract upgradeable; only the ERC-4337 `SparkPointAccount` is UUPS-upgradeable (user-controlled) and was already CREATE2-counterfactual via its factory.
- Deterministic via Foundry's **canonical CREATE2 factory** (`0x4e59…4956C`, present on Base Sepolia). **Bump the salt tag only to intentionally mint a fresh, distinct set** of addresses (e.g. a clean environment) — never to "upgrade" a live contract.
- **Shipping a *corrected* contract** (changed bytecode) therefore lands at a **new** address by design; update the shared address books + env and record both addresses in the release notes (see Rollback below).

## Release procedure (production) — planned

1. `develop` is green and deployed; smoke-check the develop URL.
2. **(If DB)** apply migrations to prod; record in [MIGRATIONS.md](./MIGRATIONS.md).
3. **(If contracts)** deploy/verify on Base; record addresses + the Tenderly/Etherscan verification in the release notes.
4. Open PR `develop → main`; wait for the OH Defender scan (Check Run green).
5. **Merge** (non-Friday, batched).
6. Deploy to the **client's production infra** (mechanism TBD — fill in once the handoff is scoped).
7. **Verify** — on Coolify-hosted prod, via the deployment record (`status: finished`, see COOLIFY.md); on client infra, via the client's deploy record + a prod smoke-check.
8. Tag `vX.Y.Z` on the merge commit + publish a GitHub Release from [CHANGELOG.md](./CHANGELOG.md).

## Rollback

- **Coolify (dev/staging):** no rollback API — `git revert` the offending commit and push (Coolify redeploys), or redeploy a previous known-good deployment in the Coolify dashboard.
- **Client production (TBD):** rollback follows the client infra's mechanism; document it here when known. For smart contracts there is **no rollback** — contracts are immutable; mitigate via the **pause-only kill-switch** (constitution N5: pause new deployments, never block user withdrawals) and ship a corrected contract.
