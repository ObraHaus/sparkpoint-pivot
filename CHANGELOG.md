# Changelog

All notable changes to **SparkPoint Pivot** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **History note.** The changelog starts here — earlier entries remain available in the git history.
> The repo changelog and the in-app changelog (`services/agent/content_seed/whats-new.json`) are
> reset together; a seed reset prunes the old in-app entries on the next agent boot/reingest.

## [Unreleased]

### Security

- **Dependency CVE patch pass (055)** — `next` 16.3.6 → 16.4.3 patches two CRITICAL RCEs (`GHSA-2464-fhr4-w9xw` image-optimization SVG, `GHSA-673q-mjm6-r5xr` `use cache` typed arrays), HIGHs `CVE-2026-94482`/`CVE-2026-94483`, and five MEDIUMs (`CVE-2026-103004`, `-94484`, `-94485`, `-94543`, `-94544`); `eslint-config-next` tracks the same version. `sharp` 0.35.4 → 0.35.5 (`GHSA-wq5f-xc86-pv6w`) and `source-map-js` 1.2.1 → 1.2.2 (`CVE-2026-93749`) via root `pnpm.overrides`, and `certifi` 2026.6.17 → 2026.10.23 (`GHSA-6q48-6c7w-9gw2`) in `services/agent/uv.lock`. `zod` 3.25.76 → 4.6.7 via the `zod/v3` compatibility entry point (the `CVE-2023-54404` fix landed in 4.6.6), pinned with a root `pnpm.overrides` selector `zod@<4.6.6` → `>=4.6.6 <5` (the selector form leaves each importer's `specifier` tracking its own manifest instead of rewriting it to the override range).

### Fixed (free chat restored + failed turns refunded)

- **Free chat works again on beta.** The `sparkpoint-chat` group's 2026-10-14 pair was dead — OpenRouter's Nvidia provider returned **404** for `nvidia/nemotron-3-super-120b-a12b:free` (`status -5`) and Google AI Studio returned **429** for `google/gemma-4-31b-it:free` — so every free turn failed with `UPSTREAM_UNAVAILABLE`. `services/litellm/config.yaml` now serves three free deployments from three different providers: **Nemotron 3 Ultra 550B A55B** (primary, weight 4), **Cohere North Mini Code** (weight 3), and **Poolside Laguna S 2.1** (weight 1). All were probed live with the deployed key (HTTP status, latency, prose, Taglish, and the agent's real intent-JSON prompt) before the switch; no paid model was added to the free group and no free → paid fallback was introduced (cost changes need operator approval).
- **A 404 in one free deployment now fails over instead of ending the turn.** The pinned gateway image is **LiteLLM 1.92.0**, whose `should_retry_this_error` raises `NotFoundError` before the in-group retry loop; `router_settings.enable_weighted_failover: true` is the safe 1.92.0 knob that re-picks a weighted, healthy deployment in the same group while excluding the failed one. `allowed_fails: 1` / `cooldown_time: 30` are unchanged, and the premium → free fallback is unchanged.
- **Sparky's prose budget has room for reasoning models.** The new free models spend 60–380 tokens reasoning before answering, so the general-branch `max_tokens` moved from 320 to 640. The user-visible reply is still clamped at 700 characters, so answers do not get longer.
- **A failed turn no longer consumes the daily chat quota.** `/chat`, `/recommendations`, and `/onboarding/turn` still charge once when admitted, but a turn that ends in an LLM/upstream failure now refunds that unit to the **same metric and the window captured at consume time** (clamped at 0, masked `refund` limits event, no migration). Refunds are fail-safe and never break the response; a successful turn and a client disconnect are never refunded.

### Changed (AI model lineup — chat, self-authoring, embeddings)

- **The gateway model lineup is switched on both environments.** `sparkpoint-chat` is now **Ling 3.0 Flash Sante (free)** with a **Qwen 3.8 27B (free)** fallback; `sparkpoint-chat-premium` is now **Ling 3.1 Flash** with an **Apodex 1.1 Mini (free)** fallback (both currently $0 upstream; costs pinned to 0 in the config so spend accounting stays honest). `sparkpoint-selfauthor` — Sparky's daily self-authored research job — is now defined in `services/litellm/config.yaml` with the same pair as premium, so it exists on **both** gateways; previously it lived only in the alpha gateway's LiteLLM DB, which is why beta self-authoring runs had no model. All four upstreams were probed live (clean JSON, 262k ctx) before the switch.
- **The RAG embedding model is switched to `nvidia/llama-nemotron-embed-vl-1b-v2:free`** (OpenRouter; native 2048-dim, MRL-truncated to the pinned 1024). This is a **re-embed event**: the pin is bumped to `nvidia-llama-nemotron-embed-vl-1b-v2-mrl1024@2026.10.0`, and the `memory_chunks` corpus is cleared and re-ingested on both alpha and beta (knowledge seed, changelog, tips). The truncation path was validated against the provider's own 1024-dim output (cosine ≥ 0.9999999) so the pgvector `vector(1024)` column and HNSW index are unchanged. The relevance fixture is regenerated from the new space. No secret/PII handling changed: every ingest still passes the fail-closed PII scan before any embed call.
- **Embedding requests now retry transient failures.** The OpenRouter embeddings POST retries 429/502/503/504/529 and transport errors (timeouts/resets) with jittered backoff, honoring `Retry-After` and capped at 5 attempts / 60s, then fails CLOSED exactly as before. A `:free`-tier rate-limit therefore skips one fewer ingest (or changelog entry at boot). Non-retryable 4xx still propagate on the first response, and no retry log or error ever carries the URL or key. Mirrors the `llm.resilience` policy without importing the SDK (the knowledge tier stays free of the LLM package).

### Added (public beta — the whitelist gate is now a switch)

- **beta.sparkpoint.io is open to everyone.** A new web env **`BETA_OPEN=true`** admits every wallet that completes SIWE to the (app) shell — the DB beta allowlist, the `/apply` form, and the 1M-SRK auto-gate no longer restrict entry while it is on. Admin is unchanged: `/admin` + the admin APIs still require an `admin` row (non-admins still get the invisible 404). **FAIL-CLOSED** — only an explicit `"true"` opens the beta; `false`/unset restores the closed beta with no code revert. Applied at all four server points (edge middleware, BFF beta gate, session read, SIWE verify), so sessions minted under the closed beta are admitted too, and the SRK gate is skipped. Access only — `/exit`, `/trust`, and withdraw are never gated (N2).

### Reverted (broker art cut-out, for now)

- **The transparent broker cut-out is reverted.** The cut-out edges read as broken on the live page, so the original collection image (square, studio background) and the rectangular gold frame are back. The brokers section itself is unchanged. Mirrors the sparkpoint.io revert.

### Added (Sparky Brokers landing section)

- **The landing has a Sparky Brokers stop between the hero and 01.** A new Three.js pose draws a gold picture-frame outline around the collection art (measured to the art's on-screen box, so it hugs it on desktop and the stacked mobile/reduced-motion layouts), then morphs into the starfield; the existing six poses shift one later and the scroll dots now track **7** sections. The panel carries the OpenSea collection profile image, an **unactivated → activated gold-frame** preview of the burn-SRK membership (Premium + a weight in every revenue payout; transfer clears activation), a 3-step flow, and a **View on OpenSea** CTA. Same section shipped to `sparkpoint.io` via `ObraHaus/sparkpoint-landing`.
- Fixed along the way: badge→kicker spacing (the kicker had no top margin), and the active scroll dot now switches with the panel actually on screen instead of lagging one section.

### Fixed (apply page title)

- **The `/apply` browser-tab title no longer says “Sparky” twice** — the page title already carried a `— Sparky` suffix and the root layout template appends another. It now sets the bare title and lets the template do its job (`Apply for beta access — Sparky`).

### Security

- **`next` 16.3.3 → 16.3.6**, patching `GHSA-vcvr-r3jv-pc5j` (critical: RCE in the Node.js `next/og` `ImageResponse`). Our `opengraph-image`/`apple-icon` routes render static content only — no attacker-controlled values reach the SVG — so the app was not exploitable, but the dependency gate blocks the release and the patched build is free. `eslint-config-next` tracks the same version.

### Fixed (beta stage copy — the app and landing read their real stage)

- **beta.sparkpoint.io no longer calls itself alpha.** The landing's apply CTA and closing fine print, the `/apply` page (title, metadata, form lede), the bridge "unavailable" copy, the `/changelog` subtitle, and the settings delivery note now read the single `NEXT_PUBLIC_APP_STAGE` source (`stageCopy`) instead of hardcoded "alpha": the beta build says **Beta** / "beta-gated" / "gated beta", and the testnet build keeps **Alpha**. Copy only — the server-anchored beta allowlist, the access gate, and every route are unchanged.

### Fixed (custody answers + swap-card copy)

- **The custody/safety questions are answered deterministically** — "how do you keep my funds safe?", "can you withdraw my funds?", "what happens if you disappear?" now return the code-authored guarantees (only you sign; withdrawals are never gated; no custody or rehypothecation) without a model call, so they keep working when the provider is rate-limiting. An order with an amount ("withdraw 100 USDC") is still routed to the build path.
- **The chat's swap card names the real pair** — it said "ETH ↔ USDC" on Robinhood Chain, where the stable is USDG; it now reads the proposed pair's own symbols.

### Fixed (assistant resilience + the vault-rate answer)

- **The assistant is more patient with provider rate limits.** A 429 burst used to exhaust three attempts in under 8s (full-jitter waits as short as 0.2s), surfacing "Something went wrong" for questions that a short wait would have answered. Five attempts with an equal-jitter floor (≈0.5s → 10s between tries, 60s total budget) ride out a burst.
- **"What's the vault paying now?" is answered from the stored record** — the same figure the board renders, deterministically (no model call). With no stored rate it says "I won't invent a rate" rather than guessing.

### Fixed (withdraw receipt + chat vault questions)

- **The withdrawal receipt shows the amount you actually withdrew.** A full withdrawal zeroes the position, and the success body was rebuilt from the live model — so it read "$0.00 is back in your wallet". The receipt now snapshots the figures at Sign (`receiptAmounts()` → `okBody(signed)`) and renders what was signed.
- **"What vaults are available right now?" is answered from the curated board.** The deterministic curated route only matched best/top-style questions, so a LIST question fell into the recommender and got "I couldn't find a strategy that clears your current guardrails" on a chain where the recommender has nothing to propose. A new list shape (`is_vaults_list_question`) enumerates every curated vault from the same stored record, marks the published pick, and links the Vault page — no model call, no invented vault. Best/top questions still name the pick; a command with an amount still builds an action.
- **The chat's wallet line names the chain's stable** — "idle USDG" on Robinhood Chain, never a hardcoded "USDC".

### Fixed (portfolio withdraw control is a real button)

- **The portfolio row's "Withdraw" is a keyboard-focusable button**, not an anchor without an href (which has no link role and cannot be tabbed to). The row remains clickable.

### Added (withdraw from the vault card + the portfolio row)

- **A holder can withdraw straight from the vault card.** When the connected wallet holds a curated wrapper, its card on `/vault` now shows a "You hold $X" chip and a **Withdraw** action (the feature card too), routing into the withdraw screen with that vault selected — no longer only via Trust & Exit. The portfolio's held-wrapper row is clickable to the same screen and carries a "Withdraw" link.

### Fixed (share amounts + withdraw copy)

- **Share amounts render at the share token's own scale.** A V3 wrapper reads 9 share decimals over a 6-dp asset, and the deposit/withdraw screens formatted shares with the asset scale — so a 0.4-share deposit displayed as "400.0 shares". They now use the vault's `shareDecimals`, and the deposit preview shows "…" until `previewDeposit` resolves.
- **The withdraw preview names the real asset** ("≈ 0.05 USDG", not USDC), and small share amounts no longer round to "0.0".

### Fixed (deposit acknowledgement copy)

- **The deposit acknowledgement names the real asset and the real amount.** It said "This uses your full idle balance, leaving no USDC buffer in your wallet" even for a small partial deposit on a chain whose stable is USDG. It now reads from the live figures: "This uses 45% of your idle USDG, leaving 0.47 USDG in your wallet." (or "full idle USDG balance" when it truly is the whole balance).

### Fixed (beta deposit gate + portfolio polish)

- **Curated-vault deposits are signable again on the beta.** The confirm gate required the agent's launch-vault quote/simulate, which fail closed on a chain without the launch vault (503 NOT_DEPLOYED), so "Sign deposit" never appeared for a curated wrapper. For a curated wrapper the gate now rests on the direct-RPC ERC-4626 preview — the same read the transaction relies on — and the UI states honestly that Sparky's policy check applies to our own vault, not third-party ones.
- **Confirm copy names the real asset** (USDG, not USDC) and shows "…" for the share estimate until `previewDeposit` resolves (no momentary "≈ 0.0 shares").
- **The wallet-tokens card lists the chain's known tokens** (stable + wrapped native), so a wallet holding USDG no longer reads "No ERC-20 tokens in this wallet yet".
- **Allocation center pluralizes** ("1 position").
- Content + portfolio reads retry a transient 401 when the shell mounts before the SIWE session cookie exists.

### Fixed (beta revenue — multi-token display, broker list, fee row)

- **The revenue page shows every fee asset, in its own units.** The pot row was ETH-only and the per-broker holdings printed raw base units plus a truncated address (`810 units of 0x5fc5…d168` for a 0.00081 USDG balance). The page now reads the engine's registered assets, reads each token's own `symbol`/`decimals`, and renders the pot, each broker's holdings and the withdrawable header per asset (ETH + any registered ERC-20); a token whose metadata cannot be read still falls back to base units. The AS-IS disclosure and route copy now say ETH and ERC-20 rather than "ETH in, ETH out".
- **The fallback broker scan no longer hides brokers behind a burned id.** It walked `1..totalSupply`; a fusion burns an absorbed broker, so with id 1 burned and id 10 minted (`totalSupply` 9) the smoke wallet's #10 was invisible (8 shown of 9 held). The scan now walks `1..min(maxSupply, 500)`, reads ownership in its own phase (8-read engine state only for ids the wallet holds), and uses `balanceOf` to say precisely when the list is short.
- **The swap confirm's fee row can no longer render a real fee as "0".** `maximumFractionDigits: 6` showed `0 ETH` for a real 0.0000002 ETH fee; sub-1e-6 amounts now fall back to their exact decimal string via the shared `formatAmount`, used by both the swap page and the chat card.
- **4663 reads batch through Multicall3** (canonical `0xcA11…CA11`, code verified on-chain), so a `useReadContracts` batch is one `eth_call` instead of N.

### Fixed (053 follow-up — flow-indexer cursor)

- **The flow indexer's cursor is now chain-scoped.** All flow rows live under the agent's shared mirror network id, so two chains shared one watermark — indexing the higher-blocked chain could advance the other past its head and silently stop its history. The configured vault chain keeps the historical stream; every other chain gets its own. (Found while verifying 053 Phase C live.)

### Added (053 Phase C — wrapper flows indexed, so PnL/history are real on the beta)

- **The flow indexer now watches the curated wrappers too.** `VaultFlowIndexer` takes a list of addresses (one `eth_getLogs` filter), each decoded flow stamps its own emitting contract, and the background loop refreshes the watch list from the admission mirror every tick — a wrapper deployed minutes ago starts being indexed on the next pass. A chain with no launch vault is no longer skipped.
- **`GET /portfolio` returns real wrapper PnL.** Each held wrapper's cost basis / unrealized / realized come from its own indexed flows (surfaced only when the replay reconciles and the asset is USD-priced); a single held wrapper also yields the position-value series, and the response totals sum the wrapper legs. `GET /portfolio/positions/wrapper:<proxy>` resolves one wrapper's position + event history. Unindexed history stays `null`/`pending`, never guessed.
- The web positions table shows wrapper PnL when the agent's replay is live (the key maps `ext:<addr>` → `wrapper:<addr>`).

### Added (053 Phase B — the AI sees the beta portfolio)

- **`GET /portfolio` reads the beta portfolio on Robinhood Chain.** When the request chain has no launch vault, the endpoint returns the wallet's idle stable plus every whitelisted curated wrapper it holds (shares, `convertToAssets`, asset), valued at $1 par only when the wrapper's asset IS the chain stable — an unpriced asset is shown but never invented into USD. The chain is no longer reported `stale` merely for lacking the launch vault; a real read failure still degrades to `200 + stale:true` with zeroed figures. `VaultReader` gained generic `convertToAssets`/`asset`/`decimals` reads at arbitrary addresses, and a per-chain `STABLE_ASSET_ADDRESS` (verified defaults, env-overridable) powers the par valuation.
- **The chat portfolio provider reads the same positions** the app shows (idle stable + held curated wrappers), so recommendations start from what the user actually holds on 4663.

### Added (053 — the beta portfolio)

- **The portfolio now shows the wallet's real funds on the Robinhood Chain beta.** Positions, allocation and net worth are composed from direct on-chain reads: the chain stablecoin (USDG, valued at $1 par — labelled), native ETH (kept separate, never priced), and every curated wrapper the wallet holds (read from the live board, not a static list). Before any deposit the idle balance is a position row with a "Put it to work" CTA instead of an empty state, and the "AI vault isn't in the beta yet" copy is gone.
- **Wallet tokens + add-by-address.** The token card lists the known tokens per chain (stable, wrapped native, curated wrapper shares) read over RPC — which works on 4663, where the explorer is Cloudflare-gated — and accepts an "add token by address" (probe-validated as an ERC-20, persisted per chain+wallet, removable, display-only).
- **Honest history on the beta.** The value chart says "No history yet — it appears after your first deposit" instead of a network placeholder; PnL stays "pending" until the flow indexer covers wrapper deposits (053 Phase C).

### Changed (beta copy — the app speaks only to what is live)

- **Copy pass across the beta surfaces.** The vault picker, deposit/withdraw notices, strategies, fees and portfolio copy now describe only the live curated-vault program — no references to unscheduled launches. The vault picker on the beta shows curated vaults only, and the default deposit selection is the first live vault.
- **Copy pass (continued).** The public landing page, SEO metadata, onboarding, premium, automation, portfolio position detail, and the chat follow-up chips now describe only the live curated-vault program, in the app's own words.

### Fixed (051 follow-up — beta deposit route, CTA wording, fresh builds)

- **The deposit/withdraw screen now works for curated wrappers on the beta.** The route-level “no vault on this build” notice (correct for the Base-only Aave vault) fired before the `?vault=` selection was read, so the Steakhouse wrapper’s deposit page showed “isn’t part of the Robinhood Chain beta yet”. The notice now renders only when no curated wrapper is selected, and the form shows **Deposit USDG** with the wrapper’s own asset.
- **CTA wording:** “Deposit via SparkPoint wrapper” → **“Deposit USDG”** (the token). “SparkPoint wrapper” no longer appears in vault UI copy — docs/learn/trust keep the full term.
- **Portfolio beta notice** now points at the live curated vaults instead of claiming the AI vault is absent on 4663.
- **Auto-refresh on new deployments:** page HTML was served from Next’s full-route cache with `s-maxage=31536000`, so a reload kept the old build and the force-refresh banner looped to a manual Refresh. The root layout is now `dynamic = "force-dynamic"` — HTML is no-store, while `/_next/static` chunks keep immutable caching.
- **The force-refresh build id is deterministic now.** `next.config.ts` is evaluated more than once per build, so appending `Date.now()` gave the client and server bundles **different** ids for the same build — the stale-tab check saw a permanent mismatch and the banner looped to a manual Refresh (observed live: HTML `…mu9o4ris` vs `/api/version` `…mu9o4rpg`). The id is now the commit (stable across evaluations, still changes on every real deploy), and commit-only ids compare by inequality.

### Added (052 — token logos)

- **Real token logos across the app.** The collected art is bundled locally in `apps/web/public/tokens/`: USDG (the official Global Dollar mark), ETH/WETH/USDC, and 11 of the 14 Robinhood Stock Tokens (full-colour official marks via Wikimedia Commons; CRCL monochrome via Simple Icons). `lib/logos.ts` now resolves **local-first** by chain + exact address or a verified symbol, then the Trust Wallet CDN, then the letter avatar — so the swap picker/header, the vault cards (feature + live) and the portfolio rows show real marks on 4663 instead of letters. The verified-only symbol rule and “decorative, never a trust signal” are unchanged. SPY, QQQ and GLD keep the avatar (no reliable public logo found).

### Added (051 — universal-wrapper deposit/withdraw rail)

- **The board's CTA now routes into the live V3 wrapper.** A new `universal_wrapper` vault kind threads through the options → `useVault` → confirm model: the app reads the wrapper's own `asset()` and the asset's decimals separately (the V3 wrapper runs 9 share decimals over a 6-dp asset, unlike the legacy wrappers), trusts the **curated board's** `wrapped` + `wrapperAddress` record as provenance (V3 has no factory attestation), and fails closed ("Unverified vault") without it. Deposit signability also requires the wrapper asset to match the chain stable.
- **The amount screen resolves dynamically-deployed wrappers** (vault page + deposit/withdraw merge the board's live wrappers into the options), shows the **stored curator-scan APY labeled as such** ("3.62% (curator scan)"), and withdraw stays ungated by provenance (N2). The legacy "In-app deposit coming soon" copy is replaced by a working deposit rail.

### Fixed (050 follow-up — live-page polish + e2e proof)

- **The feature card renders with the full brand gradient** (white text, light badges, translucent chart panel) — matching the approved Option C wireframe instead of a thin gradient border.
- **A deployed wrapper is no longer described as “not deployed yet.”** The deposit rail now distinguishes “wrapper deployed on-chain, in-app deposits not wired for this build yet” (with the wrapper address) from a genuinely undeployed wrapper — no false claim, no dead CTA. (Full in-app deposit routing for the V3 universal wrapper is the next build item.)
- **Fork e2e proof added** (`contracts/test/fork/UniversalWrapperV3Fork.t.sol`): against live 4663 state, a 10 USDG deposit into the live V3 wrapper mints shares and redeems back to principal, and a round trip can never return more than it put in.

### Changed (050 — /vault redesign: editorial feature + live-only cards)

- **The vault page is card-first now.** A full-width **Sparky recommends** feature card leads (net APY, stored-scan sparkline, TVL/withdrawable, Deposit + Ask Sparky), followed by every live vault as a card with badges and CTAs. The list **lazy-loads on scroll** (batches of 6, a spinner row, then “You’ve reached the bottom — that’s every live vault Sparky has wrapped”), with an honest empty state when nothing is wrapped.
- **Only wrapped vaults are public.** Candidates, approved-but-unwrapped, whitelisted/cooling, cancelled/failed and uncurated rows no longer appear on `/vault` — they live in Admin → Vaults only. An **admin session** additionally sees an in-flight panel directly under the feature card (counts + **Manage in Admin → Vaults**), fed by admin-gated endpoints and never rendered for public sessions.
- **New `curated_vault_apy_history` (migration 0041)** records one APY observation per vault per curator scan so the card sparkline is real stored history; the public board returns the last ~30 points per vault. Fail-open: an unapplied table means no chart, never a broken page. The hero falls back to the highest-score **live** vault when the published pick isn’t wrapped.

### Removed (049 — retired the V2 wrapper request queue)

- **The pre-pivot wrapper deploy request queue is gone.** The routes (`/admin/vaults/wrappers*`, `/curator/wrapper-jobs*`), the `PgDeploymentStore` module, and their tests were removed; the V3 admission queue (`/admin/vaults/whitelist*` + `/curator/wrapper-whitelist*`) fully replaces them. The `wrapper_deployments` table (migration 0039) is retained as history and no code reads or writes it (safe to drop later). No on-chain effect.

### Changed (049 V.4 — V2 factory sunset completed)

- **The pending Sep 22 `setDeployer` timelock op was cancelled** (Safe B, canceller 2-of-3; tx `0x481f6e18…c239`, 2026-09-20): `isOperationPending` = false on-chain, and the auto-execute cron was already removed. The sunset V2 factory never deployed a wrapper; `wrapper.factoryV3` is the live admission gateway. Recorded in `contracts/deployments/4663/addresses.json → wrapper` (`factoryStatus`, `timelockOps.setDeployer.status`).

### Fixed (049 runner)

- **The AI admission runner now reports `byAddress` with its whitelist result.** The agent's admission mirror records the on-chain `by` so the panel's provenance (AI entry vs admin admission) is honest; without it the row showed no provenance. (The live Steakhouse row was backfilled.)

### Added (049 V.6b/V.7 — admission panel + V3 wiring)

- **Admin → Vaults now has the admission queue.** The retired wrapper-request card is replaced by a wallet-signed queue: every approved unwrapped vault shows its admission state (not admitted / cooling off with a live countdown / ready / wrapped / cancelled / failed) with **Whitelist now**, **Deploy now** (releases a cooling AI entry first), **Release** and **Cancel** actions signed by the operator EOA on 4663, plus the AI cooling-off window setting (1–168 hours; chain bounds read live). The agent only records the confirmed txs — it never signs.
- **V3 wiring:** `packages/shared` now exports `sparkPointVaultFactoryV3Abi`, and the 4663 address book carries `sparkPointVaultFactoryV3` (`0x1de85106…6406`), `sparkPointVaultTimelock` (`0x62b8…b0B5`) and `sparkPointVaultBeacon` (`0xC4D6…ab0c`). The deployer app's `WRAPPER_FACTORY_ADDRESS` moves to the V3 proxy (operator env change at promotion).
- **Trust Center states the admission model plainly:** AI admission under a configurable cooling-off window, operator instant admission / release / cancel, one wrapper per vault enforced on-chain, and the timelock confined to code/proxy upgrades and non-admission parameters.

### Added (049 V.6a — admission queue: agent migration + routes)

- **The agent now mirrors the V3 admission lifecycle** (`wrapper_whitelist`, migration **0040** — PENDING on develop; apply with `PGCLIENTENCODING=UTF8` before the next agent redeploy): `child_address`, `by_address`, `ready_at`, the prefilled wrapper params, `status` (`pending | deployed | cancelled | failed`) and the tx/proxy/CapRegistry/error record. New routes: `GET /curator/wrapper-whitelist` (the AI runner's unwrapped candidates with deterministic params) + `POST …/report` (whitelist/deploy results, failures as loud as successes) and `GET /admin/vaults/whitelist` + `POST …/record` (the panel records the instant wallet-tx lane; the agent never signs). A successful deploy still flips the curated row to `wrapped`. The AI defaults mirror the P11 form exactly (fee 1000, CapRegistry defaults scaled by asset decimals, `sp…` symbol, `· SparkPoint wrapper` label). 19 new pytest units; the retired V2 request queue is untouched until the panel switches in V.6b.

### Changed (governance — constitution v4.1.0: AI-autonomous admission under an on-chain cooling-off window)

- **Constitution v4.1.0 ratified** (MAJOR; operator grant 2026-09-19, reviewed at V.1 and landed with the V3 deploy): Guardrail IV.5(b) admission moves from “no single key may add an entry” (multisig + timelock per vault) to **factory RBAC** — the AI deployer admits a child that unlocks after an on-chain cooling-off window (default 24h, admin-bounded 1h–7d, a plain inline `block.timestamp` check, no TimelockController action), the operator admin admits/deploys instantly and may release or cancel a pending AI entry, and **one wrapper per child is enforced on-chain**. The timelock's purpose is narrowed to **code/proxy upgrades and non-admission parameters** (beacon, guardian, fee recipient, deploy limit, role administration). **N1–N5 are unchanged** (no new asset path, no admin withdrawal, exits never gated); the wrapper implementation and the TimelockController-owned beacon are untouched. Full proposal: `.specify/memory/constitution-amendment-v4.1.0.md`.

### Added (049 V.3 — V3 factory deployed + verified on 4663)

- **`SparkPointVaultFactoryV3` is live on Robinhood Chain 4663** (operator-signed with the `sparkybeta-deployer` keystore, 2026-09-19): implementation `0xa65596e6…2213` (tx `0x64d884db…79ea`, block 67,221,158) behind a Transparent proxy `0x1de85106…6406` (tx `0xc4a2b7f2…166f`, block 67,221,165; ProxyAdmin `0x8C40…E2e1` owner = the timelock). Initializer roles verified on-chain: `DEFAULT_ADMIN_ROLE` = the TimelockController `0x62b8…b0B5` (which holds neither admission role), `ADMIN_ROLE` = the operator EOA `0x3762…7dE8`, `DEPLOYER_ROLE` = the AI deployer `0xB555…D875`; `cooldown()` = 86,400 (min 3,600 / max 604,800); beacon / guardian / timelock / feeRecipient wired; `deployLimit` 0. Recorded under `wrapper.factoryV3` in `contracts/deployments/4663/addresses.json`. The sunset V2 factory remains untouched; nothing is wrapped yet.

### Added (049 V.2 — V3 factory: AI-autonomous admission under amendment v4.1.0)

- **`SparkPointVaultFactoryV3` implemented and Foundry-tested** (merged in PR #228, deployed in V.3). The admission model is rebuilt on OpenZeppelin `AccessControl`: `DEFAULT_ADMIN_ROLE` = the TimelockController (role admin + beacon/guardian/fee-recipient/deploy-limit only), `ADMIN_ROLE` = the operator EOA (instant `whitelistVault`, `releaseNow`, `unwhitelist`, `setCooldown`, `createVault`), `DEPLOYER_ROLE` = the AI deploy runner (`whitelistVault` → deployable after the on-chain cooldown; `createVault`). The cooldown is a plain inline `block.timestamp` check — default 24h, admin-bounded 1h–7d, evented — with **no timelock in the admission path**; the timelock is deliberately not an admission role. Admission is one pending `{by, readyAt}` per child; `createVault` consumes it and records `wrapperOf[child]`, so exactly one wrapper per child is enforced on-chain. The whitelist is the allowlist and the existing fee/caps/child validation and `deployLimit` are retained; the runner's “AI never deploys admin-added entries” rule stays off-chain (provenance via `by`). 41 new Foundry tests (role separation incl. “the timelock cannot admit”, initializer grants + duplicate-holder guard, cooldown math/bounds/release/unwhitelist, one-per-child, child validation, deploy limit, N1 value rejection, timelock-only upgrade) plus `script/DeployVaultFactoryV3.s.sol`.

### Removed (web)

- **The “SparkPoint’s own vault” card is gone from `/vault`.** The vault program is wrap-only for now — curate an existing vault, wrap it via our factory, onboard it — so the page stays focused on the curated board and no longer implies a SparkPoint-originated vault is coming to this network.

### Added (P11 — product wiring + disclosure)

- **Wrapper deployments are now a reviewable request in Admin → Vaults.** A new queue card lists every request and lets an admin request one for an approved vault (fee defaulting to 10%, caps to the CapRegistry defaults) or cancel it while pending; the deploy is executed by the scoped runner, never the agent.
- **A verified deploy reaches the board by itself.** When the runner reports a successful `createVault`, the curated row flips to `wrapped = true` with the deployed proxy address, so the deposit rail routes through the wrapper (with its performance-fee disclosure) instead of a direct deposit. Failures leave the row unwrapped and are recorded loudly.
- **Trust Center now states the real upgrade model**: wrappers upgrade only through the 3-of-5 proposer Safe and a 72-hour timelock, with an independent 2-of-3 canceller; no upgrade or pause can block an exit; residual risk stated plainly. The "non-upgradeable" claim is now scoped to SparkPoint's own vault.
- Cap inputs in the admin form are converted through a tested helper (`toRawCaps`) so a mistyped cap cannot silently block deposits.

### Added (P12 — on-chain vault discovery)

- **The curator now discovers vaults from the chain itself, not just an API.** A new crawler enumerates every `VaultV2Factory.CreateVaultV2` log on 4663 (block 0 → head), reads each vault's facts on-chain (asset, `totalAssets`, fees, curator/owner, age, gate abdication) and re-checks the FR-020 gate abdications for every candidate. API candidates missing from those logs get a DANGER warning and fail screening; API rows are cross-checked against chain truth (asset address/symbol mismatch or a >50% TVL disagreement is DANGER); a configured crawl that fails **fails the run** (last-good list preserved) unless `CURATOR_ONCHAIN_REQUIRED=false` opts into API-only degradation. A second, optional archive RPC derives a share-price APY for vaults the API has no figure for.
- **Adapter pointed at the right source: `api.morpho.org/graphql` + the `vaultV2s` query.** The previous `blue-api…vaults` call returns an empty set on 4663 because the chain is V2-only — that empty set, not an empty chain, was the "0 vaults" blocker. First live run: **58 vaults enumerated, 58 verified, pick = Steakhouse USDG (~$482.4M, 3.58% net APY, score 57)**, alternate Purinta USDG.

### Fixed (beta runners)

- **The `deployer` service was rejected by the container healthcheck.** `healthcheck.ts` still only allowed `keeper` / `sweeper` / `curator`, so the new `sparkpoint-deployer-beta` container exited 1 on every health probe and Coolify stopped it right after deploy. The deployer now has its own freshness window driven by `DEPLOYER_POLL_SEC` (default 120s), plus a regression test covering the service list.

### Added (049 — wrapper fleet deployed on Robinhood Chain 4663)

- **The universal wrapper fleet is live on 4663** (operator-signed, 2026-09-19): TimelockController `0x62b8b01c…b0B5` (72h delay, PROPOSER = a 3-of-5 Safe `0xA63Ad1a2…E7Bf`, CANCELLER = an independent 2-of-3 Safe `0xe208F33a…8150`, deployer renounced admin), `UpgradeableBeacon` `0xC4D6D11f…ab0c`, `SparkPointUniversalVault` implementation `0xCe1cd084…3D542`, and `SparkPointVaultFactoryV2` behind a Transparent proxy `0x040A7BFD…466dE` (owner/guardian = the timelock). All roles, owners and the 72h delay verified by on-chain reads; recorded in `contracts/deployments/4663/addresses.json → wrapper`. The AI deployer (`0xB555…D875`) was enabled through the timelock: `schedule` executed 2026-09-19 (Safe-A tx `0x9e6d3d05…c0df`, op `0x3581b36c…85e0`), permissionless `execute` due 2026-09-22 07:43:22 UTC; nothing is wrapped yet — Gate 0 (a live child vault on 4663) still stands.


### Added (049 P9 — scoped wrapper deploy runner)

- **Agent queue + S2S work/report surface**: `wrapper_deployments` (migration 0039) records an admin's wrapper deploy request and the runner's result — loud failures included; `/curator/wrapper-jobs*` is machine-facing (S2S, no admin) and never authority. Registered before the `/admin/vaults/{vault}` catch-all.
- **`runners/src/deployer.ts`** (`SERVICE=deployer`): the scoped executor — local validation, on-chain allowlist check, simulate + `createVault`, success-receipt check, `VaultCreated` decode, CREATE2 salt from the request id, and lost-report recovery (existing code at the predicted address ⇒ report without a second tx). Holds the deploy-only key; contains no upgrade/allowlist/pause/fund selector (pinned by test). 14 new node:test units.


### Changed (governance — constitution v4.0.0: universal upgradeable wrapper family)

- **Contracts implemented (spec 049 P8):** `SparkPointUniversalVault` (universal implementation; child bound at initialization with no setter; child-claim `totalAssets`; HWM performance fee with fail-open accrual; caps + deposit-side pause; direct child unwind with a V2 `max*==0` liquidity fallback; `minSharesOut` overload; ERC-7201 storage), `SparkPointVaultFactoryV2` (fundless factory behind a Transparent proxy; curated allowlist; role-gated scoped deployer; on-chain child validation; CREATE2 BeaconProxy + per-wrapper CapRegistry; optional rolling deploy limit), plus OZ `UpgradeableBeacon` (owned by the timelock). 20 new Foundry tests (binding, gates, fee-above-HWM, loss/flat, pause-only, caps, slippage, donation, V2 fallback, beacon/factory upgrade authorization); full contracts suite **460 passed**. Not deployed — audit + operator-signed deploy remain.

- **Constitution v4.0.0 ratified** (MAJOR; operator grant 2026-09-18): NON-NEGOTIABLE **N5** is redefined from "non-upgradeable custody semantics" to **bounded, verifiable custody semantics** — a wrapper admitted under IV.5 may be upgraded **only** through a TimelockController-owned beacon (3-of-5 proposer, independent 2-of-3 canceller, ≥72h delay, no EOA), whose upgrade path is never an asset path and never gates withdrawals. Guardrails IV.5(a)/IV.6, Principle V (wrapper shapes + factory), the upgradeability constraint, and the named-contracts list are amended accordingly; single-child/no-meta-vault, allowlist admission, N1–N4, and the fee model are unchanged. Proposal: `.specify/memory/constitution-amendment-v4.0.0.md`.
- **Spec 049 (`specs/049-universal-vault-wrapper/`)** specifies the beacon fleet (`SparkPointUniversalVault` + TimelockController-owned beacon + deploy-only `SparkPointVaultFactoryV2` + `BeaconProxy` per curated vault) and the **scoped AI deployer** (deploy-only hot key held by a deterministic runner, never the keyless LLM agent). Residual risk recorded: an upgrade key can replace custody code — the timelock is a speed limit and exit window, not an impossibility proof.
- **Program roadmap** added at `docs/orchestration/vault-program-roadmap.html` (phases, status, decision log).

### Added (AI-curated vaults — spec 048, phases M2 + M4 + M3)

- **The curated store (agent, migration `0038_curated_vaults`).** Four additive tables: `curated_vaults` (screened vaults with verbatim score inputs, screening verdicts, observed APY/TVL/liquidity, status and provenance), `vault_recommendations` (one pick + alternates per run, idempotent on `run_key`; unpublished rows are AI proposals the public read ignores), `vault_curation_audit` (every admin action and run report), `vault_curation_state` (`auto_publish` — default **off**: "AI proposes, admin publishes" — last-run timestamps and the Run-now request marker). Admin edits set `provenance='admin'` and are never overwritten by a scan; the scan never writes `status` on an existing row. ⚠️ **PENDING** on develop — apply with `PGCLIENTENCODING=UTF8` before the curator runner deploys (see `MIGRATIONS.md`).
- **Public read `GET /vaults/curated`** returns `{ pick, alternates, vaults, lastRunAt, source }` with an honest empty shape. An empty board carries a note explaining WHY; figures are the stored ones (NULL stays unknown, never 0). Admin endpoints (`/admin/vaults/curation*`) mirror the tips/access panels: list, approve, deny, pin/unpin, hide, edit (provenance freeze), add-by-address (server-side rail validation), Run-now (a request marker, not a command), auto-publish toggle, audit.
- **Keyless curator runner (`runners/src/curator.ts`).** Holds no wallet: reads the agent's run-state, queries Morpho's GraphQL API (`CURATOR_CHAIN_ID`, default 4663), screens (asset allowlist, TVL, withdrawable liquidity, age, listed, anomaly guard, source warnings), scores deterministically (score → TVL → address), and publishes via the S2S admin API. Fail-open: a failed run writes only the failure state — the last good list and pick keep serving. A daily loop plus a 5-minute poll for admin "Run now". Pinned by 27 `node:test` units (live-verified: 4663 → 0 vaults, 8453 → 100 discovered / 13 accepted / deterministic pick).
- **`/vault` — wireframe A + C.** Hero "Sparky's pick today" (reason, net APY, TVL, curator, as-of), a curated table with filter + "new this week", per-row provenance chips (AI / Admin / Admin pick) and last-scan line; honest empty states that separate never-run, failed and genuinely-empty. A chat entry point opens `/chat?ask=…` with the question prefilled (the chat page reads it once and strips the URL). Deposit rail: wrapped → the wrapper page with the performance-fee disclosure; unwrapped → direct ERC-4626 with the no-fee disclosure; a claimed-but-undeployed wrapper renders "not yet", never a dead CTA. On the 4663 beta the curated board IS the vault page; the SparkPoint Aave vault stays stated as Base-only.
- **Chat answers from the curated record.** "What's the best vault? / where should I deposit?" is a deterministic route (no model call): it reads the same stored row `/vault` renders, names the pick with its stored figures and as-of, and deep-links to the board. A store outage yields an honest error block, never a remembered vault or a model-supplied APY.
- **Admin → Vaults → Curated panel.** Candidate queue with scores/failed screens, approve/deny/pin/hide, metadata editor, add-by-address, Run-now with the request/runner-boundary explained, an auto-publish toggle, and the audit log.
- **Trust Center disclosure** for off-chain AI curation, admin override, and the performance-fee-only model (fee only on gains above the high-water mark; no deposit/withdraw/flat/loss fee).
- **Ops:** optional Uptime-Kuma push heartbeat (`CURATOR_KUMA_PUSH_URL`) — the curator pings UP after a published run and DOWN when discovery fails, so a monitor alerts on a stale board, not just a live process; container healthcheck + `SERVICE=curator` support; runbook/env table in `runners/README.md`; new `runners` CI workflow (typecheck + unit tests).

### Changed (swap polish — more tokens, one-tap chat swaps, less chrome)

- **The swap picker now recommends Robinhood Chain's canonical Stock Tokens** — SPY, NVDA, TSLA, GOOGL, META, COIN, AAPL, AMZN, MSFT, SPCX, QQQ, GLD, CRCL, RDDT. Addresses come from Robinhood's **official asset registry** (`api.robinhood.com/rhj/assets`, the same source as docs.robinhood.com/chain/contracts) and each was verified on-chain (18dp + a live Uniswap V3 pool vs WETH/USDG). Any other ERC-20 remains paste-importable.
- **“Route via” is gone from `/swap`.** Uniswap V3 is the one venue wired for execution and the quote engine already chooses the pool/path; the selector was chrome. The chosen route is still disclosed on the confirm screen.
- **Chat swap proposals arrive pre-filled.** “Swap 0.001 ETH to USDG” opens the inline card with the amount and both tokens already set — the user only confirms. To make that safe, `_swap_proposed_action` now carries the FROM token's real `decimals` (USDG is 6dp on 4663; the legacy field previously claimed 18) and the chain-local stable symbol (never labels USDG as USDC), and the card scales the base-unit amount with the resolved token's decimals (recommended pin or on-chain read).
- **SRK Pons buy link wired** (operator-confirmed launchpad URL) and the **Sparky Broker OpenSea link now points at the collection**.

### Changed (beta polish — honest labels, tidier pages, less in the way)

- **Fixed the label/value spacing on the broker and revenue pages.** `.payrow` was only styled on the premium page, so rows rendered as “Supply9 of 5,555 exist”; the style now lives in the global sheet.
- **“Partial data” chips are gone.** When something isn't available yet, the page says so plainly (the same register as `/vault` and `/strategies`) instead of carrying a badge.
- **Navigation cleanup:** Bridge is hidden for now, SRK moved inside Learn, and the Changelog moved into Settings — all still deep-linkable and searchable.
- **No testnet/faucet copy on the beta.** The testnet funding tip and the vault tips are gone; the SRK page no longer offers a faucet, states that SRK is a placeholder token, and links to its Pons launchpad.
- **The Sparky Broker page links to OpenSea** and says the collection is a placeholder for testing.

## [0.3.0] — 2026-09-18 — Beta launch (Robinhood Chain)

### Added

- **beta.sparkpoint.io is live on Robinhood Chain (4663).** Wallet connect + SIWE sign-in, Sparky chat, portfolio reads (native ETH + USDG), and user-signed **ETH ↔ USDG** swaps on the network's own Uniswap V3.
- **The 0.20% swap fee, disclosed before signing.** A non-custodial `FeeRouter` charges the fee on the input side and routes it to the immutable `RevenueSplitter` (90% broker holders / 10% treasury); the confirm screen shows the exact fee and where it goes.
- **Sparky Broker (test collection).** Clock in, promote and fuse brokers; Pons trading fees flow `splitter → engine pot → per-broker vault`, and a broker's owner withdraws what it earned.
- **Trust Center** lists every deployed 4663 contract with verifiable addresses — including the fee router and the swap quote source.

### Fixed

- **Sign-in no longer stalls** on a slow fail-open check (hard time budget + retry; the button says which step it is on).
- **Swap quotes work again** — 4663 shipped without a working quoter; a minimal read-only quote contract was deployed and wired.
- **The changelog reset clears the old in-app rows completely.** The seed prune now also removes entries created before slugs existed (seed-owned, `slug IS NULL`), so the in-app changelog shows exactly the committed seed — while an operator's Admin → Updates edit is still never touched.
