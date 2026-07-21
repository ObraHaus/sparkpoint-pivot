# Feature Specification: Universal Vaults

**Feature Branch**: `010-universal-vaults`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Make the app universal / multi-vault so the AI can SEE external Morpho/QuickNode-Earn vaults and suggest better yield strategies, and adding a future vault is easy (registry-only). Advisory + read-only only — no custody change."

## Clarifications

Resolved with the operator on 2026-07-21 (see the approved plan Constitution Check and Assumptions):

- **Advisory + read-only ONLY.** 010 lets the AI *see*, *rank*, and *narrate* external vaults. It does
  NOT add any external protocol to the policy `Protocol` enum, the candidate/allowlist set, or any
  `(target, selector)` permission, and it creates NO agent/vault execution path into any non-whitelisted
  protocol. The launch vault, its ABI, and its custody semantics are untouched. The *manage/execute* half
  (SparkPoint-owned wrapper vaults + `/admin/vaults` actions) is a separate companion feature, `011`.
- **External figures are labeled and fail-open.** Every external APY/TVL figure is shown as
  "estimated / external / not a SparkPoint vault", is net of the vault's own fees where the source
  provides it, and fails **open to "unavailable"** — never fabricated, never silently `0`. The SparkPoint
  launch vault's own "yield-from-Aave" claim (Constitution III) is presented separately and is unchanged.
- **Data feed = Morpho GraphQL primary, DeFiLlama / on-chain fallback.** The Morpho GraphQL API
  (`https://api.morpho.org/graphql`, public, keyless, ~750 req/min, no SLA, MAINNET-only) is the primary
  yield/TVL feed for Morpho vaults; DeFiLlama and on-chain-derived reads are the fallback. QuickNode Earn
  has no reliable public API, so it is surfaced *as* the Morpho vaults it is built on. On testnet
  (Base Sepolia 84532), where Morpho's API/app do not serve data, external APY is honestly "unavailable".
- **Adding a future vault is registry-only.** A new vault (SparkPoint's own launch vault, or any external
  ERC-4626 to display) is a single registry row `{chainId, address, protocol, abiKind, asset,
  assetDecimals, verified, label, apySource}` — no new reader class, no new ABI file, no code change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The AI can see live vault yields (Priority: P1) 🎯 MVP

Today the recommender is **yield-blind**: `_build_chain_context` sets
`market=MarketData(gross_apy_bps=None, projected_apy_bps=None)`, so the LLM ranks the code-fixed candidate
set with no real APY to reason over. US1 wires a keyless, fail-open market-data feed (Morpho GraphQL
primary + DeFiLlama / on-chain fallback) into that `MarketData`, so the assistant can compare the
SparkPoint Aave vault against external Morpho vaults on **real net APY and TVL** — as *advisory* context
only. The candidate set stays code-fixed and whitelisted; the feed never changes what is signable.

**Why this priority**: This is the core of the brief — "the AI can SEE external vaults and suggest better
yield strategies." It is the smallest slice that delivers the requested value and unblocks US3/US4. It
touches only the recommender's information set, not any execution path.

**Independent Test**: Run a RECOMMEND turn on Base mainnet config; confirm the assistant's ranking
references a live, plausible net APY + TVL for the SparkPoint Aave vault and at least one external Morpho
vault, each labeled "estimated / external"; kill the network and confirm the same turn degrades to
"yield data unavailable" (never a fabricated or `0` APY) without changing which candidates are offered.

**Acceptance Scenarios**:

1. **Given** a RECOMMEND turn with the market feed reachable, **When** the recommender builds chain
   context, **Then** `MarketData` carries a real `gross_apy_bps`/`net_apy` and `tvl` for each candidate,
   sourced from Morpho GraphQL (or the fallback), and the narration cites those figures as
   "estimated / external".
2. **Given** the Morpho GraphQL API is unreachable or rate-limited, **When** the feed is queried, **Then**
   the recommender falls back to DeFiLlama / on-chain-derived data, and if all sources fail it sets APY to
   "unavailable" — it MUST NOT emit `0` or a fabricated number.
3. **Given** a testnet config (84532) where Morpho serves no data, **When** a RECOMMEND turn runs, **Then**
   external APY is shown as "unavailable (testnet)" and the SparkPoint vault's own on-chain figures still
   render.
4. **Given** any market-feed outcome (live, fallback, or unavailable), **When** the recommender assembles
   candidates, **Then** the candidate SET and its policy stamps are byte-identical to today's — the feed
   never adds, removes, or clears a candidate, and never influences signability.
5. **Given** an external figure that the source reports gross, **When** it is shown, **Then** it is
   labeled net-of-fees where the source supplies a fee, or explicitly "gross (fee unknown)" where it does
   not — never presented as a SparkPoint net-yield guarantee.

---

### User Story 2 - A universal vault registry + generic ERC-4626 reader (Priority: P2)

Adding a vault the app can *see* becomes a single registry row. US2 introduces per-chain registry metadata
`{chainId, address, protocol, abiKind, asset, assetDecimals, verified, label, apySource}`, splits the agent
`vault_reader` `_REQUIRED_METHODS` frozenset into a **generic ERC-4626 core** (the standard 4626 surface)
vs **SparkPoint-only extras** (`performanceFeeBps`, `highWaterMark`, `feeRecipient`, `paused`, …), and adds
a web `resolveErc4626()` + `useVaults()` so both the agent and the app can read any registered ERC-4626
vault. The SparkPoint launch vault still uses the full SparkPoint reader; external vaults use the
generic-4626 core only.

**Why this priority**: Without the registry + generic reader, "see external vaults" and "adding a future
vault is easy" stay hardcoded to the one SparkPoint vault. This is the structural seam every later phase
(and companion feature `011`) reads from. It is read-only: no write path is added.

**Independent Test**: Add a registry row for a Base-mainnet curated Morpho USDC vault; without any other
code change, confirm the agent's generic reader returns its `totalAssets`/`convertToAssets`/`asset`/
`decimals` and the web `useVaults()` lists it — while the SparkPoint vault continues to expose its full
SparkPoint-only method set through the unchanged full reader.

**Acceptance Scenarios**:

1. **Given** a new external vault, **When** an operator adds one registry row, **Then** the app and agent
   can read it with **no** new reader class, ABI file, or code change (registry-only).
2. **Given** a registered external vault, **When** the generic reader loads it, **Then** it requires only
   the generic-4626 core methods and MUST NOT require or call any SparkPoint-only extra
   (`performanceFeeBps`, `highWaterMark`, `feeRecipient`).
3. **Given** the SparkPoint launch vault row (`abiKind: sparkpoint`), **When** it is read, **Then** the
   full SparkPoint reader (with all `_REQUIRED_METHODS`) is used exactly as today — no regression.
4. **Given** a registry row whose on-chain bytecode is missing or does not expose ERC-4626 `asset()`/
   `decimals()`, **When** it is resolved, **Then** the reader fails closed for that row (marks it
   "unreadable"), and MUST NOT block or corrupt reads of other vaults.
5. **Given** a registry row marked `verified: false`, **When** it is surfaced anywhere, **Then** it
   carries an "unverified external" marker and never inherits the SparkPoint launch vault's trust.

---

### User Story 3 - Read-only multi-vault visibility (Priority: P2)

The app shows the SparkPoint Aave vault **plus** the registered external vaults. US3 adds a read-only
`/admin/vaults` page listing every registered vault with live TVL / APY / state (asset, decimals,
`paused` where applicable, source badge), and extends the portfolio derivation (`derive.ts`, today a closed
`'vault' | 'idle'` union) to represent N vaults for display. There are **no** management actions on this
page — deposit/withdraw/curate/pause are the companion feature `011`'s `/admin/vaults` *manage* half.

**Why this priority**: Visibility is the operator-facing proof that the registry + feed work, and it is the
read-only surface `011` later attaches management controls to. Shipping it read-only first keeps custody
semantics obviously untouched.

**Independent Test**: Open `/admin/vaults`; confirm it lists the SparkPoint vault and each registered
external vault with live TVL/APY (or "unavailable"), the correct source + verified badges, and **zero**
buttons/forms that could move funds or change vault state.

**Acceptance Scenarios**:

1. **Given** the registry with the SparkPoint vault + ≥1 external vault, **When** `/admin/vaults` loads,
   **Then** each vault row shows label, chain, asset, live TVL, live APY (or "unavailable"), and a
   source + verified badge.
2. **Given** the read-only page, **When** it is inspected, **Then** it contains no deposit/withdraw/
   curate/pause/registry-edit control — every element is read-only (management is `011`).
3. **Given** the existing `killswitch` admin page (which already read-only-reads the single vault's
   `paused()`/`guardian()`), **When** 010 ships, **Then** that page is unchanged and `/admin/vaults` is
   additive — no existing admin surface regresses.
4. **Given** the app's portfolio display, **When** it derives holdings, **Then** it can represent the
   SparkPoint vault position alongside display-only external vault context without collapsing the closed
   `'vault' | 'idle'` union in a way that mislabels an external vault as a SparkPoint position.
5. **Given** a vault whose live figures are unavailable, **When** its row renders, **Then** it shows
   "unavailable" for that field and stays legible — no `0`, no blank that reads as zero.

---

### User Story 4 - Chat advisory parity (Priority: P3)

The assistant can *reference and compare* external vaults in chat, with **citations**, treating them as
unverified external market data. When a user asks "is there a better yield than the SparkPoint vault?",
Sparky can name external Morpho vaults, compare estimated net APYs, cite the source (Morpho GraphQL /
DeFiLlama, with timestamp), and still make clear that only the SparkPoint Aave vault is a signable,
policy-cleared SparkPoint action — external vaults are context, not proposals.

**Why this priority**: The brief asks the AI to "suggest better yield strategies"; chat is where that
suggestion is delivered. It is P3 because it reuses the US1 feed + US2 registry once they exist, and it
must never turn an external mention into a signable action.

**Independent Test**: Ask the assistant to compare the SparkPoint vault to external options; confirm it
names ≥1 external vault with an estimated net APY, a citation (source + timestamp), and an explicit
"external / not a SparkPoint vault, not a signable action" framing — and that no signable/policy-cleared
action is produced for any external vault.

**Acceptance Scenarios**:

1. **Given** a user asks for better yield, **When** Sparky answers, **Then** it may reference external
   vaults with an estimated net APY + a source citation, and it labels them "external market data".
2. **Given** an external vault referenced in chat, **When** the turn produces any proposed action, **Then**
   the only signable/policy-cleared candidate remains the whitelisted SparkPoint (Aave) action — no
   external vault is ever emitted as a candidate or `ProposedAction`.
3. **Given** the market feed is unavailable, **When** the user asks to compare, **Then** Sparky says the
   external figures are currently unavailable rather than inventing a comparison.
4. **Given** any external figure cited in chat, **When** it is shown, **Then** it carries its source and a
   recency indicator, consistent with Constitution III ("current + verifiable, never promised").

---

### Edge Cases

- **Morpho GraphQL down / rate-limited (750 req/min, no SLA)** → fall back to DeFiLlama / on-chain; if all
  fail, APY = "unavailable". Never `0`, never last-good silently presented as live (staleness is labeled).
- **Testnet (84532) has no Morpho API/app + no curated vaults** → external APY honestly "unavailable
  (testnet)"; the SparkPoint vault's own on-chain reads still work.
- **Registry row points at a non-4626 / self-destructed / EOA address** → generic reader fails closed for
  that row ("unreadable"), does not poison other rows or any RECOMMEND turn.
- **External figure reported gross vs net** → labeled accordingly; never relabeled as a SparkPoint net
  guarantee; never blended into the launch vault's own yield claim.
- **A source returns a wildly out-of-range APY (feed error / manipulated pool)** → sanity-bounded and
  labeled suspect / "unavailable" rather than shown as a headline "better yield".
- **Symbol/label collision** (an external vault labeled "USDC Vault" resembling the SparkPoint vault) →
  disambiguated by chain + address + source badge; trust keys off `verified` + `abiKind`, not the label.
- **Mainnet-only feed vs testnet-only deploy** → the launch vault runs on Base Sepolia; the yield feed is
  mainnet-only. The app shows the SparkPoint vault's real testnet on-chain figures and external mainnet
  figures as clearly-separate "external market context", never conflating chains.
- **Feed latency on the CPU-starved dev box** → the feed is time-boxed and cached; a slow feed degrades to
  "unavailable" for that turn rather than blocking the recommender.

## Requirements *(mandatory)*

### Functional Requirements

**Market-data feed (US1)**

- **FR-001**: The system MUST provide a keyless market-data feed that returns, per candidate vault, a
  current APY (gross and net where available) and TVL, with a source identifier and a fetch timestamp.
- **FR-002**: The feed MUST use the Morpho GraphQL API (`https://api.morpho.org/graphql`) as the primary
  source for Morpho vaults, and MUST fall back to DeFiLlama and/or on-chain-derived reads when the primary
  is unreachable, rate-limited, or returns no data.
- **FR-003**: The feed MUST fail **open to "unavailable"**: if no source yields a figure it MUST return an
  explicit "unavailable" state and MUST NOT return `0`, a fabricated value, or a stale value presented as
  live (staleness MUST be labeled).
- **FR-004**: The feed MUST populate the recommender's `MarketData` (today `gross_apy_bps=None`,
  `projected_apy_bps=None`) so the LLM ranks candidates over real figures — as **advisory** context only.
- **FR-005**: The feed MUST be time-boxed and cached so a slow/unreachable source degrades that turn to
  "unavailable" rather than blocking the RECOMMEND turn, respecting the ~750 req/min, no-SLA primary.
- **FR-006**: Every external figure MUST be labeled "estimated / external / not a SparkPoint vault", net
  of the source's fees where provided (else "gross (fee unknown)"), and MUST NOT be blended into the
  SparkPoint launch vault's own "yield-from-Aave" claim.

**Registry + generic reader (US2)**

- **FR-007**: The system MUST define a per-chain vault registry whose row is
  `{chainId, address, protocol, abiKind, asset, assetDecimals, verified, label, apySource}`, added to the
  agent config and to the shared per-chain `AddressBook` (a `vaults[]` list) — mirroring the address-book
  pattern 007 used for `swapFeeRecipient` (a plain data field, NOT a policy `TargetRef`).
- **FR-008**: Adding a vault the app can *see* MUST require only a new registry row — no new reader class,
  no new ABI file, and no other code change (registry-only).
- **FR-009**: The agent `vault_reader` `_REQUIRED_METHODS` MUST be split into a **generic-4626 core**
  (standard ERC-4626 surface: `asset`, `decimals`, `totalAssets`, `convertToAssets`, `convertToShares`,
  `previewDeposit`, `previewRedeem`, `balanceOf`, …) and **SparkPoint-only extras** (`performanceFeeBps`,
  `highWaterMark`, `feeRecipient`, `paused`), such that an external vault is read with the core only.
- **FR-010**: A registered external vault MUST be read with the generic-4626 core only; the reader MUST
  NOT require, call, or fabricate any SparkPoint-only extra for it. The SparkPoint launch vault
  (`abiKind: sparkpoint`) MUST continue to use the full reader unchanged (no regression).
- **FR-011**: The web layer MUST expose `resolveErc4626()` (generic on-chain 4626 read: `asset`,
  `decimals`, `totalAssets`, conversions) and `useVaults()` (list + per-vault live read) driven off the
  registry, alongside the existing single-vault `useVault.ts` path which stays unchanged for the
  SparkPoint vault.
- **FR-012**: The reader MUST fail closed per row: a registry row whose bytecode is absent or does not
  expose ERC-4626 `asset()`/`decimals()` MUST be marked "unreadable" and MUST NOT block or corrupt reads
  of any other vault or any RECOMMEND turn.

**Read-only visibility (US3)**

- **FR-013**: The app MUST display the SparkPoint Aave vault alongside every registered external vault,
  each with its live TVL/APY (or "unavailable"), asset, and a source + verified badge.
- **FR-014**: The system MUST add a **read-only** `/admin/vaults` page listing all registered vaults with
  live TVL/APY/state. It MUST contain no deposit, withdraw, curate, pause, or registry-edit control —
  every management action is the companion feature `011`.
- **FR-015**: The portfolio derivation (`derive.ts`, today a closed `'vault' | 'idle'` union) MUST be
  extended to represent multiple vaults for display without mislabeling any external vault as a SparkPoint
  position or as a signable holding.
- **FR-016**: External vault rows MUST be visually and semantically distinguished from the SparkPoint
  launch vault (source + `verified` + `abiKind` badges), so an external vault is never presented as a
  SparkPoint vault or strategy.

**Chat advisory parity (US4)**

- **FR-017**: The assistant MAY reference and compare registered external vaults in chat, and MUST cite the
  source (Morpho GraphQL / DeFiLlama) with a recency indicator for every external figure it states.
- **FR-018**: An external vault referenced in chat MUST NEVER be emitted as a candidate, `ProposedAction`,
  or any signable/policy-cleared item; the only signable yield action remains the whitelisted SparkPoint
  (Aave) candidate.
- **FR-019**: When the market feed is unavailable, the assistant MUST say the external figures are
  unavailable rather than fabricate a comparison (Constitution III).

**Governance / scope boundary (load-bearing)**

- **FR-020**: 010 is **advisory and read-only**. It MUST NOT add Morpho, QuickNode Earn, or any external
  protocol to the policy `Protocol` enum, the `Asset` enum, the candidate/allowlist set, or any on-chain
  `(target, selector)` permission, and it MUST NOT create any agent or vault **execution path** into a
  non-whitelisted protocol. Advisory *information about* a protocol is not *interaction with* it. External
  market data influences ranking/narration ONLY and MUST NEVER influence signability (Constitution II & IV
  — see plan Constitution Check; mirrors 007's FR-024).
- **FR-021**: 010 MUST NOT touch the launch vault: no change to `SparkPointVault.sol`, its ABI, its
  `_REQUIRED_METHODS` semantics for the SparkPoint vault, its fee model, its non-upgradeability, or its
  custody semantics (Constitution I & V). Any change touching custody semantics is out of scope and
  requires re-ratification (which 010 does not seek).
- **FR-022**: The `packages/shared` policy `Protocol` enum and its TypeScript mirror
  (`packages/shared/src/policy/enums.ts`, CI parity T098) MUST remain byte-identical to today after 010;
  the registry `protocol` field is a **display/data** attribute distinct from the policy `Protocol` enum
  and MUST NOT be conflated with it.

### Key Entities

- **VaultRegistryEntry**: one row describing a vault the app can *see* —
  `{chainId, address, protocol (display label, e.g. "morpho"/"aave_v3"/"sparkpoint"), abiKind
  ("sparkpoint" | "erc4626"), asset, assetDecimals, verified (bool), label, apySource ("morpho_graphql"
  | "defillama" | "onchain")}`. Lives per-chain in the agent config and the shared `AddressBook.vaults[]`.
  A plain data field, NOT a policy `TargetRef`.
- **MarketData (extended)**: the recommender's per-candidate market context — now carrying real
  `gross_apy_bps` / `net_apy` / `tvl` / `source` / `as_of` / an "unavailable" state, instead of today's
  `None`. Advisory only; does not gate signability.
- **VaultReadout**: the result of reading a registered vault — the generic-4626 core figures
  (`asset`, `decimals`, `totalAssets`, conversions) plus, for `abiKind: sparkpoint` only, the SparkPoint
  extras (`performanceFeeBps`, `highWaterMark`, `feeRecipient`, `paused`); or an "unreadable" state.
- **MarketQuote**: a single source's answer for one vault — `{apySource, apy (gross/net), tvl, as_of,
  available}`; combined by the feed into the advisory figure with fail-open semantics.
- **VaultDisplayRow**: the read-only `/admin/vaults` + app view-model of a vault — label, chain, asset,
  live TVL/APY (or "unavailable"), source + verified badge, and a "SparkPoint vs external" distinction.

### Non-goals (explicitly out of scope for 010)

- Any deposit/withdraw/curate/pause/registry-write action on any vault — that is companion feature `011`
  (the manage/execute half; `011`'s `/admin/vaults` manage controls attach to this read-only page, and
  `011`'s wrapper vaults are read through this registry + generic reader).
- Adding any external protocol to the policy engine, candidate set, `Asset`/`Protocol` policy enums, or an
  on-chain allowlist (forbidden by FR-020/FR-022).
- Any change to `SparkPointVault.sol`, the AA account stack, session keys, or the deterministic policy
  engine's execution authority.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a mainnet-config RECOMMEND turn, the assistant's ranking references a live, plausible net
  APY + TVL for the SparkPoint Aave vault **and** ≥1 external Morpho vault, each labeled
  "estimated / external", with no code or config edit beyond a registry row.
- **SC-002**: When every market source is unavailable, 100% of RECOMMEND turns show external APY as
  "unavailable" (0 fabricated values, 0 `0`-APY placeholders) and offer the **identical** candidate set +
  policy stamps as today.
- **SC-003**: Adding a new external vault the app can see requires exactly **one** registry row and zero
  other code changes (no new reader class / ABI file), verified end-to-end for one Base-mainnet Morpho
  vault.
- **SC-004**: An external vault is read with the generic-4626 core only (0 SparkPoint-only extras
  required/called for it), while the SparkPoint launch vault continues to read its full method set with no
  regression (existing single-vault reads + tests green).
- **SC-005**: `/admin/vaults` lists the SparkPoint vault + every registered external vault with live
  TVL/APY/state and source badges, and contains **0** controls that can move funds or change vault state.
- **SC-006**: In chat, external vaults can be compared with a source citation + recency, and **0** external
  vaults are ever emitted as a candidate/`ProposedAction`/signable action.
- **SC-007**: No policy regression: the policy `Protocol`/`Asset` enums, the candidate/allowlist set, the
  `(target,selector)` permissions, and the `enums.ts` TS mirror are byte-identical before and after 010
  (CI parity T098 green); `SparkPointVault.sol` is untouched.
- **SC-008**: No custody regression: no new custodial contract, no new execution path into any
  non-whitelisted protocol; every non-custody invariant (N1–N5) is confirmed unchanged.

## Assumptions

- The market feed is **advisory**: it feeds the LLM's ranking/narration only. The candidate set stays
  code-fixed and whitelisted (`agents/recommender.py` builds it; the model only ranks/narrates), so the
  feed can never add a signable action — consistent with Constitution II.
- Morpho GraphQL is public, keyless (~750 req/min, no SLA, **mainnet-only**); DeFiLlama and on-chain reads
  are the fallback. QuickNode Earn has no reliable public API and is surfaced *as* its underlying Morpho
  vaults. Morpho subgraphs are deprecated and not used.
- The launch vault runs on Base Sepolia (84532) where Morpho serves no yield data; external APY there is
  honestly "unavailable (testnet)". Base mainnet (8453) config is where external curated-vault figures are
  real. The two are shown as separate contexts, never conflated by chain.
- The registry `protocol` field is a **display/data** attribute; it is deliberately distinct from the
  policy `Protocol` enum (`aave_v3` / `aerodrome` / `sparkpoint_vault`) and does not touch it (FR-022).
- "Adding a vault is easy" means a *display/advisory* vault via a registry row. Making a vault
  *deposit/withdraw-able* is out of scope and is companion feature `011` (which reads this registry).
- The read-only `/admin/vaults` page is the surface `011` later attaches management controls to; shipping
  it read-only first keeps 010's custody-neutrality obvious and auditable.
- This feature does not touch `SparkPointVault.sol`, the AA account stack, session keys, or the
  deterministic policy engine's execution authority (FR-020/FR-021).
